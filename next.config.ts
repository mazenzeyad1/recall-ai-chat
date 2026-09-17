import type { NextConfig } from "next";

/**
 * Stripe Projects writes provider credentials into .env under its own names.
 * Next only exposes NEXT_PUBLIC_* to the browser, so map the two public
 * Supabase values across here rather than hand-editing the managed .env.
 */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_PROJECT_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
  },
};

export default nextConfig;
