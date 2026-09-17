/**
 * Applies scripts/schema.sql to the Supabase Postgres provisioned by
 * Stripe Projects. Credentials come from the CLI-managed .env — this script
 * reads it, it never writes to it.
 *
 *   npm run migrate
 *
 * Note: SUPABASE_DB_URL and SUPABASE_POOLER_URL arrive with a *placeholder*
 * password baked into the string. The real one is SUPABASE_DB_PASS, so the
 * parts are taken from the URL and the password is supplied separately —
 * which also sidesteps URL-encoding issues with special characters.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = readFileSync(join(root, ".env"), "utf8");

function readEnv(name, required = true) {
  const line = envFile.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!line) {
    if (required) throw new Error(`${name} is not in .env — run: stripe projects env --pull`);
    return null;
  }
  return line[1].trim().replace(/^["']|["']$/g, "");
}

const password = readEnv("SUPABASE_DB_PASS");

/** Build pg connection config from a URL, ignoring its placeholder password. */
function configFrom(urlString) {
  const u = new URL(urlString);
  return {
    host: u.hostname,
    port: Number(u.port) || 5432,
    database: u.pathname.slice(1) || "postgres",
    user: decodeURIComponent(u.username),
    password,
    ssl: { rejectUnauthorized: false },
  };
}

// Direct connection first; the pooler is the fallback for networks where
// the db.*.supabase.co host does not resolve (it is IPv6-only on some projects).
const candidates = [
  ["direct", readEnv("SUPABASE_DB_URL")],
  ["pooler", readEnv("SUPABASE_POOLER_URL", false)],
].filter(([, url]) => url);

const sql = readFileSync(join(root, "scripts", "schema.sql"), "utf8");

let applied = false;
for (const [label, url] of candidates) {
  const client = new pg.Client(configFrom(url));
  try {
    await client.connect();
    await client.query(sql);

    const { rows } = await client.query(`
      select tablename,
             (select count(*) from pg_policies p where p.tablename = t.tablename) as policies
      from pg_tables t
      where schemaname = 'public'
      order by tablename
    `);
    console.log(`Applied via ${label} connection. Tables in public:`);
    for (const r of rows) console.log(`  ${r.tablename} (${r.policies} RLS policies)`);
    applied = true;
  } catch (err) {
    console.error(`${label} connection failed: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }
  if (applied) break;
}

if (!applied) {
  console.error("Could not apply the schema over any connection.");
  process.exitCode = 1;
}
