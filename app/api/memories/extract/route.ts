import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { completeChat } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 45;

const EXTRACTION_PROMPT = `You extract durable facts about a user from a chat transcript.

Return ONLY a JSON array of strings. No prose, no code fences.

Include a fact only if it is stable and would still be useful weeks later:
names, location, job, preferences, constraints, allergies, goals, things they own.

Exclude anything transient: what they are asking right now, small talk,
one-off questions, or facts about the assistant.

Write each fact as a short third-person sentence, e.g. "Lives in Cairo."
If there is nothing durable, return [].`;

/** Pulls a JSON array out of a model reply that may be wrapped in prose. */
function parseFacts(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim())
      .filter((f) => f.length > 3 && f.length <= 200)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let conversationId: string | undefined;
  try {
    conversationId = (await request.json()).conversationId;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  }

  // RLS confines this to the caller's own conversation.
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (!history || history.length === 0) {
    return NextResponse.json({ added: [] });
  }

  const transcript = [...history]
    .reverse()
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  let facts: string[];
  try {
    const reply = await completeChat([
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: transcript },
    ]);
    facts = parseFacts(reply);
  } catch (err) {
    // Memory extraction is best-effort; a failure must not break the chat.
    // It is logged rather than swallowed, so a dead model is visible.
    console.error("[memories/extract]", err instanceof Error ? err.message : err);
    return NextResponse.json({ added: [], error: "extraction_unavailable" });
  }

  const added: string[] = [];
  for (const content of facts) {
    const { error } = await supabase
      .from("memories")
      .insert({ user_id: user.id, content });

    // 23505 = unique violation, i.e. we already knew this fact.
    if (!error) added.push(content);
    else if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ added });
}
