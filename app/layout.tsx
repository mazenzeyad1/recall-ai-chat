import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recall — AI chat that remembers",
  description:
    "An AI chat app with memory that carries across conversations. Built with Stripe Projects, OpenRouter, Supabase and Vercel.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
