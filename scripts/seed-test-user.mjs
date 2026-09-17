/**
 * Dev helper: creates a pre-confirmed test account so the app can be exercised
 * end-to-end while email confirmation is switched on.
 *
 *   node scripts/seed-test-user.mjs [email] [password]
 *
 * The user is written straight into Supabase's auth schema rather than through
 * the signup API, so no confirmation email is sent to the address. Delete the
 * account before judging with:  node scripts/seed-test-user.mjs --remove
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = readFileSync(join(root, ".env"), "utf8");
const env = (n) => {
  const m = envFile.match(new RegExp(`^${n}=(.*)$`, "m"));
  if (!m) throw new Error(`${n} missing from .env`);
  return m[1].trim().replace(/^["']|["']$/g, "");
};

const remove = process.argv.includes("--remove");
const args = process.argv.slice(2).filter((a) => a !== "--remove");
const EMAIL = args[0] ?? "demo@example.com";
const PASSWORD = args[1] ?? "recall-demo-2026";

const u = new URL(env("SUPABASE_DB_URL"));
const client = new pg.Client({
  host: u.hostname,
  port: Number(u.port),
  database: u.pathname.slice(1),
  user: decodeURIComponent(u.username),
  password: env("SUPABASE_DB_PASS"),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

if (remove) {
  const { rowCount } = await client.query("delete from auth.users where email = $1", [EMAIL]);
  console.log(`Removed ${rowCount} account(s) for ${EMAIL}.`);
  await client.end();
  process.exit(0);
}

// pgcrypto lives in the extensions schema on Supabase.
await client.query("set search_path to public, extensions");

// auth.users indexes email with a partial unique index, which ON CONFLICT
// cannot infer — so replace the row outright. Identities and app rows are
// removed by cascade.
await client.query("delete from auth.users where email = $1", [EMAIL]);

const { rows } = await client.query(
  `insert into auth.users (
     instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data
   ) values (
     '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
     'authenticated', 'authenticated', $1::text, crypt($2::text, gen_salt('bf')),
     now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
   )
   returning id`,
  [EMAIL, PASSWORD],
);
const userId = rows[0].id;

// GoTrue scans these into non-nullable Go strings. A manually inserted row
// leaves them NULL, which surfaces as "Database error querying schema" on
// sign-in, so blank them out.
await client.query(
  `update auth.users set
     confirmation_token         = coalesce(confirmation_token, ''),
     recovery_token             = coalesce(recovery_token, ''),
     email_change_token_new     = coalesce(email_change_token_new, ''),
     email_change_token_current = coalesce(email_change_token_current, ''),
     email_change               = coalesce(email_change, ''),
     phone_change               = coalesce(phone_change, ''),
     phone_change_token         = coalesce(phone_change_token, ''),
     reauthentication_token     = coalesce(reauthentication_token, '')
   where id = $1::uuid`,
  [userId],
);

// Supabase requires a matching identity row for password sign-in.
await client.query(
  `insert into auth.identities (
     id, user_id, identity_data, provider, provider_id,
     last_sign_in_at, created_at, updated_at
   ) values (
     gen_random_uuid(), $1::uuid,
     jsonb_build_object('sub', $1::text, 'email', $2::text),
     'email', $2::text, now(), now(), now()
   )`,
  [userId, EMAIL],
);

await client.end();

// Prove it works through the real auth endpoint.
const res = await fetch(`${env("SUPABASE_PROJECT_URL")}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: env("SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const body = await res.json();
console.log("sign-in check:", res.status, body.access_token ? "session granted" : JSON.stringify(body).slice(0, 200));
console.log(`\nTest credentials: ${EMAIL} / ${PASSWORD}`);
