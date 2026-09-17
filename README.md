# Recall — an AI chat that remembers you

Most chat apps forget you the moment you open a new thread. Recall doesn't.
It pulls durable facts out of your conversations, stores them against your
account, and injects them into every future chat — including brand-new ones.

Tell it *"I'm allergic to peanuts"* in one conversation, start a fresh one,
ask *"what am I allergic to?"*, and it answers correctly with no shared
history between the two threads.

Every service behind it was provisioned with the
[Stripe Projects](https://docs.stripe.com/projects) CLI.

**Live:** https://recall-ai-chat.vercel.app

### Try it without signing up

The Supabase project has email confirmation switched on, so a fresh signup
needs a link from your inbox. To skip that, there is a shared demo account:

```
demo@example.com / recall-demo-2026
```

It is deliberately public and shared — anything you tell it is visible to
anyone else using the same account, so don't put real personal details in it.
Create your own account if you want private memory.

## Stack

| Layer | Service | Why |
|---|---|---|
| LLM | OpenRouter (free tier) | One API across many models, with per-model failover |
| Auth + database | Supabase (free tier) | Postgres, auth, and row-level security in one project |
| Hosting | Vercel (hobby) | Zero-config Next.js deploys from git |
| Framework | Next.js 16, React 19, Tailwind 4 | App Router, streaming responses |

## How the memory works

There are two distinct layers, and that distinction is the whole point:

1. **Conversation history** — the last 40 turns of the *current* thread, sent
   to the model on every request. This is what ordinary chat apps do.
2. **Durable memory** — after each exchange, a second cheap model call reads
   the recent turns and extracts stable facts (name, location, job,
   preferences, allergies, goals) as a JSON array. Those are deduplicated and
   stored in `public.memories`, then prepended to the system prompt of
   *every* conversation for that user.

Transient things ("what's the weather", "thanks!") are explicitly excluded, so
memory stays small and relevant. Each remembered fact is listed in the sidebar
and can be deleted with one click — the user can always see and edit what the
app knows about them.

## Security model

This project has **no Supabase service-role key** — Stripe Projects issues
only a publishable key. That is a constraint worth stating plainly: there is
no privileged server client anywhere in this codebase. Every read and write,
including from route handlers, runs as the signed-in user and is filtered by
the row-level security policies in [`scripts/schema.sql`](scripts/schema.sql).

All three tables (`conversations`, `messages`, `memories`) have four policies
each — select, insert, update, delete — all keyed on `auth.uid() = user_id`.

Verified: an anonymous request and a second authenticated user both read zero
rows of another user's data.

## Running it locally

Requires the [Stripe CLI](https://docs.stripe.com/stripe-cli) with the
`projects` plugin.

```bash
stripe plugin install projects
stripe projects init          # authenticates and creates the project
npm install
npm run migrate               # applies scripts/schema.sql to Supabase
npm run dev
```

`stripe projects env --pull` refreshes `.env` if credentials rotate. The file
is CLI-managed and git-ignored — never edit it by hand.

### Note on the connection string

`SUPABASE_DB_URL` and `SUPABASE_POOLER_URL` arrive with a **placeholder**
password baked into the URL. The real password is in `SUPABASE_DB_PASS`.
`scripts/migrate.mjs` takes the host/port/user from the URL and supplies the
password separately, which also avoids URL-encoding problems.

### Note on email confirmation

The Supabase project ships with email confirmation on, so a new signup gets a
confirmation link before it can sign in. To make demos instant, turn off
**Confirm email** under Authentication → Providers → Email in the Supabase
dashboard (`stripe projects open supabase`).

For local testing without touching that setting — and to create the shared
demo account above — `scripts/seed-test-user.mjs` writes a pre-confirmed
account straight into the auth schema, so no mail is ever sent:

```bash
node scripts/seed-test-user.mjs you@example.com your-password
node scripts/seed-test-user.mjs you@example.com --remove
```

## Model routing

Free models on OpenRouter go in and out of service constantly. OpenRouter's
own `models` fallback array reports the entire call as failed when the
provider it picks is overloaded, so [`lib/openrouter.ts`](lib/openrouter.ts)
tries each model as a separate request and takes the first that answers.

Current chain: `nex-agi/nex-n2.5-pro` → `inclusionai/ling-3.0-flash-vl` →
`nvidia/nemotron-3-super-120b-a12b`, all `:free`.

If chat stops working, the models have probably rotated. List what's live:

```bash
node -e "fetch('https://openrouter.ai/api/v1/models').then(r=>r.json()).then(j=>console.log(j.data.filter(m=>m.id.endsWith(':free')).map(m=>m.id).join('\n')))"
```

## Project layout

```
app/
  page.tsx                    chat (auth-gated server component)
  login/page.tsx              sign in / sign up
  auth/callback/route.ts      email confirmation link handler
  api/chat/route.ts           streaming completion + message persistence
  api/memories/route.ts       list and delete remembered facts
  api/memories/extract/       fact extraction after each exchange
components/Chat.tsx           chat UI, streaming reader, memory sidebar
lib/openrouter.ts             model routing and SSE parsing
lib/supabase/                 browser and server clients
scripts/schema.sql            tables, indexes, RLS policies
scripts/migrate.mjs           applies the schema
```
