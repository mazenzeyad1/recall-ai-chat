/**
 * OpenRouter access, provisioned by Stripe Projects on the free plan.
 *
 * Every model here is a `:free` variant, so the project stays on the free
 * tier. OpenRouter rotates which free models it serves, so the list is a
 * fallback chain — it tries them in order and uses the first that responds.
 */
export const FREE_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "inclusionai/ling-3.0-flash-vl:free",
  // Last resort: capable, but a reasoning model that sometimes narrates.
  "nvidia/nemotron-3-super-120b-a12b:free",
];

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function apiKey() {
  const key = process.env.OPENROUTER_API_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_API_KEY missing — run: stripe projects env --pull");
  return key;
}

function headers() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    // OpenRouter attributes traffic with these; both are optional.
    // Header values must be Latin-1, so keep this ASCII — no em dashes.
    "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    "X-Title": "Recall - AI chat with memory",
  };
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Free models go in and out of service constantly, and OpenRouter's own
 * `models` fallback array reports the *whole* call as failed when the
 * provider it picked is overloaded. So each model is tried on its own and
 * the first one that actually answers wins.
 */
async function attempt(model: string, body: Record<string, unknown>): Promise<Response> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ ...body, model }),
  });

  if (!res.ok) {
    throw new Error(`${model} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

/** Streaming completion. Returns the raw SSE body for the caller to parse. */
export async function streamChat(messages: ChatMessage[]): Promise<Response> {
  const failures: string[] = [];

  for (const model of FREE_MODELS) {
    try {
      const res = await attempt(model, { messages, stream: true, max_tokens: 1200 });
      if (res.body) return res;
      failures.push(`${model} -> empty body`);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`All free models failed. ${failures.join(" | ")}`);
}

/** Non-streaming completion, used for memory extraction. */
export async function completeChat(messages: ChatMessage[], maxTokens = 400): Promise<string> {
  const failures: string[] = [];

  for (const model of FREE_MODELS) {
    try {
      const res = await attempt(model, { messages, max_tokens: maxTokens });
      const json = await res.json();

      // A 200 can still carry an error envelope, or an empty completion.
      if (json?.error) {
        failures.push(`${model} -> ${JSON.stringify(json.error).slice(0, 150)}`);
        continue;
      }
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) return content;

      failures.push(`${model} -> empty completion`);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`All free models failed. ${failures.join(" | ")}`);
}

/** Pulls text deltas out of OpenRouter's SSE stream. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;

      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // OpenRouter sends periodic comment/keepalive frames; skip them.
      }
    }
  }
}
