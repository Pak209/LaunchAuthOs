import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminDb, isFirebaseAdminExplicitlyConfigured } from "./firebase/admin";

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) { super("Too many requests. Please try again shortly."); }
}

const localWindows = new Map<string, { count: number; resetAt: number }>();

export async function enforceRateLimit(key: string, action: string, limit: number, windowSeconds: number) {
  const id = createHash("sha256").update(`${action}:${key}`).digest("hex");
  const now = Date.now();
  const windowMs = windowSeconds * 1_000;
  if (!isFirebaseAdminExplicitlyConfigured()) {
    const current = localWindows.get(id);
    if (!current || current.resetAt <= now) return void localWindows.set(id, { count: 1, resetAt: now + windowMs });
    if (current.count >= limit) throw new RateLimitError(Math.max(1, Math.ceil((current.resetAt - now) / 1_000)));
    current.count += 1;
    return;
  }
  const reference = getFirebaseAdminDb().collection("rateLimits").doc(id);
  await getFirebaseAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() as { count?: number; resetAtMillis?: number } | undefined;
    if (!snapshot.exists || !data?.resetAtMillis || data.resetAtMillis <= now) {
      transaction.set(reference, { action, count: 1, resetAtMillis: now + windowMs, expiresAt: Timestamp.fromMillis(now + windowMs * 2) });
      return;
    }
    if ((data.count ?? 0) >= limit) throw new RateLimitError(Math.max(1, Math.ceil((data.resetAtMillis - now) / 1_000)));
    transaction.update(reference, { count: (data.count ?? 0) + 1 });
  });
}

export function clientRateLimitKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown-client";
}
