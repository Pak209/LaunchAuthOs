import { redirect } from "next/navigation";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isFirebaseConfigured()) redirect("/");
  const { error } = await searchParams;
  return <LoginForm initialError={error ?? ""} />;
}
