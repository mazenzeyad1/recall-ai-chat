/**
 * Copies the credentials Stripe Projects manages in .env up to the Vercel
 * project, so builds and serverless functions can see them.
 *
 *   node scripts/vercel-env.mjs
 *
 * Only the three the app actually needs are sent. Values are never printed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = readFileSync(join(root, ".env"), "utf8");

function env(name) {
  const m = envFile.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!m) throw new Error(`${name} missing from .env — run: stripe projects env --pull`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const token = env("VERCEL_TOKEN");
const projectId = env("VERCEL_PROJECT_ID");
const teamId = env("VERCEL_TEAM_ID");
const query = teamId ? `?teamId=${teamId}` : "";

// next.config.ts maps the two Supabase values onto NEXT_PUBLIC_* at build
// time, so they must exist during the build, not just at runtime.
const KEYS = ["SUPABASE_PROJECT_URL", "SUPABASE_PUBLISHABLE_KEY", "OPENROUTER_API_API_KEY"];

const api = (path, init) =>
  fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

// Remove any existing copies so re-running is idempotent.
const existing = await (await api(`/v9/projects/${projectId}/env${query}`)).json();
for (const row of existing.envs ?? []) {
  if (KEYS.includes(row.key)) {
    await api(`/v9/projects/${projectId}/env/${row.id}${query}`, { method: "DELETE" });
  }
}

const body = KEYS.map((key) => ({
  key,
  value: env(key),
  type: "encrypted",
  target: ["production", "preview", "development"],
}));

const res = await api(`/v10/projects/${projectId}/env${query}`, {
  method: "POST",
  body: JSON.stringify(body),
});
const json = await res.json();

if (!res.ok || json.error) {
  console.error("Failed:", JSON.stringify(json.error ?? json).slice(0, 400));
  process.exitCode = 1;
} else {
  console.log(`Synced ${KEYS.length} variables to Vercel:`);
  for (const k of KEYS) console.log(`  ${k}`);
}
