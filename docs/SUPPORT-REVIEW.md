# Private pilot support review

`/support` explains practice versus saved briefs, JSON import, fact/campaign/payment distinctions, conflicts, source and derived-content deletion, and disconnect limitations. It does not create a ticket, promise staffed coverage or invent a support address.

`/admin/support` is a server-authenticated, allowlisted administrator-only read-only scan of existing fulfillment jobs, intelligence jobs, directory tasks, orders and admin operations. Each page scans at most 100 records; follow pagination and inspect every queue. Empty filtered pages do not imply absence of later cases. Returned display data contains only record references and predefined reason/action text, never raw customer content or provider errors. Existing Firestore client rules deny direct admin-operation access. No new ticket collection, polling scheduler, contact, retry or refund is performed.

Assign an accountable operator, approved customer contact channel, and response expectations before onboarding. Use existing audited operations for reconciliation; uncertain supplier acceptance requires evidence before retry. Refund requests remain pending until signed payment evidence establishes the outcome. A supplier credit, pending retraction and customer refund must not be conflated.

MCP disconnect: website sign-out is separate. Remove the ChatGPT connection and revoke provider authorization when available. Existing JWTs may remain valid until expiry; disabling the stable server account-link mapping blocks subsequent requests, while in-flight work may finish. This page does not mutate mappings or revoke grants. Do not ask customers to send credentials. Account deletion, backup expiry and protected paid-record policies remain separate decisions.
