import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertCheckoutReadiness, paidReadiness } from "../lib/readiness";

const internalRoute = readFileSync(new URL("../app/api/internal/readiness/route.ts", import.meta.url), "utf8");

function readyEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: "api-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "example.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "example",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "example.appspot.com",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123",
    NEXT_PUBLIC_FIREBASE_APP_ID: "app-123",
    FIREBASE_SERVICE_ACCOUNT_JSON: "configured",
    FIRESTORE_RULES_VERIFIED: "true",
    FIRESTORE_INDEXES_VERIFIED: "true",
    JOB_SCHEDULER_VERIFIED: "true",
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "model",
    FULFILLMENT_PROVIDER: "prnow",
    PRNOW_API_KEY: "prnow_test_key",
    PRNOW_PLAN_LAUNCH: "standard",
    PRNOW_COST_CENTS_LAUNCH: "2175",
    PRNOW_REQUIRED_CREDITS_LAUNCH: "10",
    PRNOW_PLAN_AUTHORITY: "advanced",
    PRNOW_COST_CENTS_AUTHORITY: "14900",
    PRNOW_REQUIRED_CREDITS_AUTHORITY: "100",
    PRNOW_PLAN_AUTHORITY_PLUS: "advanced",
    PRNOW_COST_CENTS_AUTHORITY_PLUS: "14900",
    PRNOW_REQUIRED_CREDITS_AUTHORITY_PLUS: "100",
    PRNOW_SUBMIT_ENABLED: "true",
    FULFILLMENT_PROVIDER_CONTRACT_APPROVED: "true",
    FULFILLMENT_PROVIDER_COSTS_VERIFIED: "true",
    STRIPE_SECRET_KEY: "sk_live_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    STRIPE_PRICE_LAUNCH: "price_launch",
    STRIPE_PRICE_AUTHORITY: "price_authority",
    STRIPE_PRICE_AUTHORITY_PLUS: "price_plus",
    NEXT_PUBLIC_APP_URL: "https://launch.example",
    JOB_RUNNER_SECRET: "x".repeat(32),
    ADMIN_USER_IDS: "user-1",
    RESEND_API_KEY: "resend-key",
    EMAIL_FROM: "Launch <launch@example.com>",
    ERROR_REPORTING_DSN: "monitoring-dsn",
    FIRESTORE_BACKUP_POLICY_CONFIRMED: "true",
    LEGAL_DOCUMENTS_APPROVED: "true",
    CONTROLLED_BETA_READY: "true",
  };
}

describe("paid launch readiness", () => {
  it("fails closed when production dependencies are missing", () => {
    const result = paidReadiness({});
    expect(result.readyForPaidUsers).toBe(false);
    expect(result.readyCount).toBe(0);
    expect(result.requiredCount).toBeGreaterThan(10);
  });

  it("rejects sandbox fulfillment even when other configuration is ready", () => {
    const env = readyEnv();
    env.FULFILLMENT_PROVIDER = "sandbox";
    const result = paidReadiness(env);
    expect(result.readyForPaidUsers).toBe(false);
    expect(result.checks.find((check) => check.id === "provider_adapter")?.ready).toBe(false);
  });

  it("becomes ready only when every launch gate is explicitly satisfied", () => {
    const result = paidReadiness(readyEnv());
    expect(result.readyForPaidUsers).toBe(true);
    expect(result.readyCount).toBe(result.requiredCount);
  });

  it("enforces every required gate before live checkout while allowing test-mode setup", () => {
    expect(() => assertCheckoutReadiness(true, readyEnv())).not.toThrow();
    expect(() => assertCheckoutReadiness(false, {})).not.toThrow();
    for (const field of ["LEGAL_DOCUMENTS_APPROVED", "FULFILLMENT_PROVIDER_CONTRACT_APPROVED", "FULFILLMENT_PROVIDER_COSTS_VERIFIED", "PRNOW_SUBMIT_ENABLED", "FIREBASE_SERVICE_ACCOUNT_JSON", "STRIPE_WEBHOOK_SECRET", "JOB_RUNNER_SECRET", "JOB_SCHEDULER_VERIFIED", "FIRESTORE_INDEXES_VERIFIED"]) {
      expect(() => assertCheckoutReadiness(true, { ...readyEnv(), [field]: "" })).toThrow(/disabled/);
    }
  });

  it("keeps the detailed readiness response behind the internal job secret", () => {
    expect(internalRoute).toContain("timingSafeEqual");
    expect(internalRoute).toContain("JOB_RUNNER_SECRET");
    expect(internalRoute).toContain('status: 404');
  });
});
