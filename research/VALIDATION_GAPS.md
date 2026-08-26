# Validation Gaps Requiring External Access

## Supplier terms

The following cannot be verified from public marketing pages alone:

- Contractual definition of guaranteed publication by outlet.
- Wholesale and volume pricing actually offered to Launch Auth.
- Refund and rejection terms, service levels, minimum commitments, and restricted niches.
- API rate limits, sandbox access, webhook behavior, reporting payloads, idempotency, and retraction behavior.
- White-label and custom-domain rights in signed terms.

Required user action: approve vendor outreach and provide a business contact identity, or create vendor accounts and share non-secret sandbox access through the local environment.

## Directory hands-on tests

BetaList, Uneed, AlternativeTo, and SourceForge flows require account-level testing. Some submissions require payment, email/phone verification, editorial review, or authorization to represent the company. Launch Auth must stop at those human boundaries.

## Production services

Persistence, authentication, billing, model-generated campaign assets, background jobs, and live fulfillment require provider choices and credentials. No secrets should be committed to this repository.
