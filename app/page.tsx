import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Chat from "@/components/Chat";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: conversations }, { data: memories }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("memories")
      .select("id, content, created_at")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <Chat
      email={user.email ?? "signed in"}
      initialConversations={conversations ?? []}
      initialMemories={memories ?? []}
    />
  );
}
