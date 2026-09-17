"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Conversation = { id: string; title: string; created_at: string };
export type Memory = { id: string; content: string; created_at: string };
type Message = { role: "user" | "assistant"; content: string };

export default function Chat({
  email,
  initialConversations,
  initialMemories,
}: {
  email: string;
  initialConversations: Conversation[];
  initialMemories: Memory[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [memories, setMemories] = useState(initialMemories);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const refreshMemories = useCallback(async () => {
    const res = await fetch("/api/memories");
    if (res.ok) setMemories((await res.json()).memories);
  }, []);

  async function openConversation(id: string) {
    setActiveId(id);
    setError(null);
    const { data } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages((data as Message[]) ?? []);
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError(null);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);
    setStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message: text }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(detail.error ?? `HTTP ${res.status}`);
      }

      const conversationId = res.headers.get("X-Conversation-Id");
      const isNew = conversationId && conversationId !== activeId;
      if (conversationId) setActiveId(conversationId);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      }

      if (isNew) {
        const { data } = await supabase
          .from("conversations")
          .select("id, title, created_at")
          .order("created_at", { ascending: false });
        setConversations((data as Conversation[]) ?? []);
      }

      // Best-effort: pull any durable facts out of this exchange.
      if (conversationId) {
        await fetch("/api/memories/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        }).catch(() => {});
        await refreshMemories();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  async function forget(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memories?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-neutral-900 md:flex">
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900"
          >
            + New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wider text-neutral-600">
            Conversations
          </p>
          {conversations.length === 0 ? (
            <p className="px-1 py-2 text-sm text-neutral-600">No chats yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`mb-0.5 w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition ${
                  c.id === activeId
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                {c.title}
              </button>
            ))
          )}

          <p className="mt-6 px-1 pb-1 text-xs font-medium uppercase tracking-wider text-neutral-600">
            Memory ({memories.length})
          </p>
          {memories.length === 0 ? (
            <p className="px-1 py-2 text-sm text-neutral-600">
              Nothing remembered yet. Tell it something about yourself.
            </p>
          ) : (
            memories.map((m) => (
              <div
                key={m.id}
                className="group mb-1 flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900"
              >
                <span className="flex-1">{m.content}</span>
                <button
                  onClick={() => forget(m.id)}
                  title="Forget this"
                  className="opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-neutral-900 p-3">
          <p className="truncate text-xs text-neutral-500">{email}</p>
          <form action="/auth/signout" method="post">
            <button className="mt-1 text-xs text-neutral-500 hover:text-neutral-300">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-8">
            {messages.length === 0 ? (
              <div className="mt-24 text-center">
                <h1 className="text-xl font-semibold">Recall</h1>
                <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
                  Tell it something about yourself, then start a brand-new chat.
                  It will still know.
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className="mb-6">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-600">
                    {m.role === "user" ? "You" : "Recall"}
                  </p>
                  <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-200">
                    {m.content ||
                      (streaming && i === messages.length - 1 ? (
                        <span className="inline-flex gap-1">
                          <span className="dot">•</span>
                          <span className="dot">•</span>
                          <span className="dot">•</span>
                        </span>
                      ) : null)}
                  </div>
                </div>
              ))
            )}

            {error ? (
              <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-t border-neutral-900">
          <form onSubmit={send} className="mx-auto flex max-w-2xl gap-2 px-4 py-4">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Send a message…"
              disabled={streaming}
              className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:bg-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
