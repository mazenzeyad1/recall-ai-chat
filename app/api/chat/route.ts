import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseSSE, streamChat, type ChatMessage } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

const HISTORY_LIMIT = 40;
const MEMORY_LIMIT = 50;

function systemPrompt(memories: string[]): string {
  const base =
    "You are Recall, a concise and friendly assistant. Answer in plain prose. " +
    "Keep replies short unless the user asks for depth.";

  if (memories.length === 0) return base;

  return (
    `${base}\n\n` +
    "Here is what you remember about this user from previous conversations. " +
    "Use it when relevant, and do not mention that you are reading from a list:\n" +
    memories.map((m) => `- ${m}`).join("\n")
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  // Start a thread on the first turn, titled from the opening message.
  let conversationId: string;
  let createdNow = false;
  if (body.conversationId) {
    conversationId = body.conversationId;
  } else {
    createdNow = true;
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        title: message.length > 60 ? `${message.slice(0, 57)}...` : message,
      })
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: `Could not start conversation: ${error?.message}` },
        { status: 500 },
      );
    }
    conversationId = data.id as string;
  }

  const { error: insertError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "user",
    content: message,
  });
  if (insertError) {
    // RLS rejects writes to a conversation the caller does not own.
    return NextResponse.json({ error: insertError.message }, { status: 403 });
  }

  const [{ data: history }, { data: memoryRows }] = await Promise.all([
    supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LIMIT),
    supabase
      .from("memories")
      .select("content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MEMORY_LIMIT),
  ]);

  const memories = (memoryRows ?? []).map((m) => m.content as string);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(memories) },
    ...(history ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    })),
  ];

  let upstream: Response;
  try {
    upstream = await streamChat(messages);
  } catch (err) {
    // Don't leave an empty thread in the sidebar because the model was down.
    if (createdNow) {
      await supabase.from("conversations").delete().eq("id", conversationId);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Model request failed." },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of parseSSE(upstream.body!)) {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        const note = `\n\n[stream interrupted: ${
          err instanceof Error ? err.message : "unknown error"
        }]`;
        controller.enqueue(encoder.encode(note));
      }

      if (full.trim()) {
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: "assistant",
          content: full,
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Conversation-Id": conversationId,
    },
  });
}
