# Validation Gaps Requiring External Access

## Supplier terms

The following cannot be verified from public marketing pages alone:

- Contractual definition of guaranteed publication by outlet.
- Wholesale and volume pricing actually offered to Launch Auth.
- Refund and rejection terms, service levels, minimum commitments, and restricted niches.
- API rate limits, sandbox guarantees, webhook behavior, submit idempotency, and exact production payload behavior. PRNow publicly documents status, links/report, package refunds, and pending retraction, but these still need account-level verification.
- White-label and custom-domain rights in signed terms.

Required user action: create the PRNow pilot account, obtain an API key, purchase only the minimum test credits, and obtain written clarification of publication/guarantee language. Add the key only to `.env.local`; never share it in chat or commit it.

## Directory hands-on tests

BetaList, Uneed, AlternativeTo, and SourceForge flows require account-level testing. Some submissions require payment, email/phone verification, editorial review, or authorization to represent the company. Launch Auth must stop at those human boundaries.

## Production services

Persistence, authentication, billing, model-generated campaign assets, background jobs, and live fulfillment require provider choices and credentials. No secrets should be committed to this repository.
