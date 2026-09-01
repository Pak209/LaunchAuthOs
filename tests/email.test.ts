import { afterEach, describe, expect, it, vi } from "vitest";
import { isTransactionalEmailConfigured, ResendEmailProvider } from "../lib/email";

afterEach(() => vi.unstubAllEnvs());

describe("transactional email boundary", () => {
  it("stays explicitly unconfigured without both server secrets", () => {
    expect(isTransactionalEmailConfigured()).toBe(false);
  });

  it("sends through an idempotent server-side provider request", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "Launch Auth <launch@example.com>");
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("email-one");
      expect(String(init?.body)).toContain("customer@example.com");
      return Response.json({ id: "email_123" });
    });
    const provider = new ResendEmailProvider(fetcher as typeof fetch);
    await expect(provider.send({ to: "customer@example.com", subject: "Confirmed", text: "Ready" }, "email-one")).resolves.toEqual({ id: "email_123" });
  });
});
