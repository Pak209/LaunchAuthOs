# Launch Auth — Roadmap

## Now

- Firebase authentication, normalized persistence, multi-project resume, autosave, immutable evidence, server-owned approvals, and tenant rules are implemented.
- Bounded multi-page intelligence and editable products, audiences, positioning, founders, milestones, proof points, competitors, confidence, and freshness are implemented.
- Real, versioned, evidence-bounded AI campaign generation and downloadable evidence reports are implemented; production model credentials remain a deployment gate.
- Stripe Checkout/webhooks, exact paid-order reconciliation, partial/full refund accounting, and non-billable sandbox protection are implemented.
- Durable fulfillment/email/verification jobs, internal queue, retry controls, placement monitoring, and removed-link detection are implemented.
- Finish supplier contracting, actual cost verification, named provider adapter, legal approval, production infrastructure, and controlled-beta operations.

## Next

- Implement the selected provider adapter against its sandbox and production API.
- Complete hands-on assisted-directory fulfillment tests and document the operator playbook.
- Configure production hosting, domain, email, error monitoring, backups, scheduler, Stripe, Firebase Admin, and OpenAI secrets.
- Run the full release procedure in `PRODUCTION_READINESS.md` and invite 3–5 controlled beta customers.

## Later

- More providers and directories.
- Authority Graph and recurring opportunity engine.
- Monitoring subscriptions and AI visibility observations.

## Gate

Do not enable live checkout until `/api/internal/readiness` is fully green, the selected provider lifecycle passes sandbox testing, supplier costs and margins are verified, and the legal/operations release gates are explicitly approved.
