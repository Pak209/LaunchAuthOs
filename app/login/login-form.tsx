"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CirclesFour, Envelope, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "check-email">("idle");
  const [error, setError] = useState(initialError);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("loading");
    const client = createClient();
    const result = mode === "signin"
      ? await client.auth.signInWithPassword({ email, password })
      : await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });

    if (result.error) {
      setError(result.error.message);
      setStatus("idle");
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setStatus("check-email");
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <span className="auth-mark"><CirclesFour size={34} weight="duotone" /></span>
        <p>Launch Auth</p>
        <h1>Build authority from evidence—not empty claims.</h1>
        <span>Secure workspaces preserve every source, approval, campaign, and fulfillment state.</span>
        <div className="auth-proof"><ShieldCheck size={20} weight="duotone" /><div><strong>Tenant-isolated by default</strong><small>Database-enforced workspace access and authenticated project operations.</small></div></div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">Production workspace</span>
          <h2>{mode === "signin" ? "Welcome back" : "Create your workspace"}</h2>
          <p>{mode === "signin" ? "Continue building your launch intelligence." : "Start with one source-backed company analysis."}</p>
          {status === "check-email" ? (
            <div className="auth-success"><Envelope size={25} weight="duotone" /><strong>Check your email</strong><span>Confirm the address to activate your workspace.</span></div>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <button className="primary-button" disabled={status === "loading"}>{status === "loading" ? "Please wait…" : mode === "signin" ? "Sign in" : "Create workspace"}<ArrowRight size={15} /></button>
            </form>
          )}
          <button className="auth-mode" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setStatus("idle"); }}>
            {mode === "signin" ? "New to Launch Auth? Create a workspace" : "Already have an account? Sign in"}
          </button>
          <div className="auth-security"><LockKey size={14} />Sessions use secure, server-readable cookies.</div>
        </div>
      </section>
    </main>
  );
}

