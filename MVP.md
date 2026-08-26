# Launch Auth — MVP

## Release goal

Ship a testable workflow from URL intake to an evidence-backed report for a small number of supported fulfillment paths.

## Thin-slice acceptance criteria

- URL intake creates a project and crawl run.
- Crawl output is source-linked and editable.
- Readiness score includes reasons and missing information.
- Customer approval is required before fulfillment.
- One provider adapter can be swapped behind a stable interface.
- Distribution states distinguish submitted, published, indexed, pending, and failed.
- Directory submissions support at least one assisted/manual path.
- Report links every claimed placement to evidence and verification time.

## V0.1 implementation status — 2026-08-26

- **IMPLEMENTED:** Public URL intake with HTTP/HTTPS, private-network, credential, DNS, content-type, response-size, timeout, and redirect controls.
- **IMPLEMENTED:** Homepage title/description extraction into a source-linked Brand Profile.
- **IMPLEMENTED:** Deterministic readiness score with rationale, missing information, and a conservative story-angle recommendation.
- **IMPLEMENTED:** Explicit VERIFIED and UNKNOWN claim states.
- **IMPLEMENTED:** Claim-by-claim approval gate and local campaign-draft state.
- **IMPLEMENTED:** Evidence table that distinguishes observed source, not submitted, and human review required.
- **BLOCKED EXTERNALLY:** Paid distribution, directory submissions, persistence, authentication, billing, provider reporting, and placement verification require selected services and credentials.

## Explicitly deferred

Broad directory coverage, automated CAPTCHA-protected flows, recurring opportunity detection, AI visibility scoring, and multi-provider optimization.
