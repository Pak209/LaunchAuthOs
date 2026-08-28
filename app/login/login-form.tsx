"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, CirclesFour, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { createUserWithEmailAndPassword, inMemoryPersistence, setPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirebaseClientAuth } from "@/lib/firebase/client";

export default function LoginForm({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState(initialError);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("loading");
    try {
      const auth = getFirebaseClientAuth();
      await setPersistence(auth, inMemoryPersistence);
      const credential = mode === "signin"
        ? await signInWithEmailAndPassword(auth, email, password)
        : await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken(true);
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create the session.");
      await signOut(auth);
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to authenticate.");
      setStatus("idle");
    }
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
          <form onSubmit={submit} className="auth-form">
            <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="primary-button" disabled={status === "loading"}>{status === "loading" ? "Please wait…" : mode === "signin" ? "Sign in" : "Create workspace"}<ArrowRight size={15} /></button>
          </form>
          <button className="auth-mode" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setStatus("idle"); }}>
            {mode === "signin" ? "New to Launch Auth? Create a workspace" : "Already have an account? Sign in"}
          </button>
          <div className="auth-security"><LockKey size={14} />Firebase identity tokens are kept in HTTP-only session cookies.</div>
        </div>
      </section>
    </main>
  );
}
