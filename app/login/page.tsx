import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Recall</h1>
          <p className="mt-2 text-sm text-neutral-400">
            An AI chat that remembers you between conversations.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <LoginForm />

        <p className="mt-8 text-center text-xs text-neutral-600">
          Provisioned with Stripe Projects · OpenRouter · Supabase · Vercel
        </p>
      </div>
    </main>
  );
}
