import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/");
  const { error } = await searchParams;
  return <LoginForm initialError={error ?? ""} />;
}

