export type EmailMessage = { to: string; subject: string; text: string };

export interface TransactionalEmailProvider {
  send(message: EmailMessage, idempotencyKey: string): Promise<{ id: string }>;
}

export class ResendEmailProvider implements TransactionalEmailProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async send(message: EmailMessage, idempotencyKey: string) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) throw new Error("Transactional email is not configured.");
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null;
    if (!response.ok || !payload?.id) throw new Error(`Transactional email failed: ${payload?.message ?? `HTTP ${response.status}`}`);
    return { id: payload.id };
  }
}

export function isTransactionalEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function getTransactionalEmailProvider(): TransactionalEmailProvider {
  if (process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER !== "resend") throw new Error("The configured email provider is not implemented.");
  return new ResendEmailProvider();
}
