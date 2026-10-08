# Launch Auth — controlled-beta operations

This playbook describes implemented controls, not evidence of a completed production pilot. Never use customer payments or supplier credits until the release gates and spending authorization are satisfied.

## Uncertain supplier submissions

1. Open `/admin` with an allowlisted administrator account. Locate the stopped submission under **Reconcile uncertain submissions**. An active worker must first finish or expire and be recovered; never reconcile a running request.
2. Compare the supplier dashboard with the recorded company, approved headline, original plan, and dispatch time. A search that returns no result is not evidence of non-acceptance. Contact supplier support when uncertain.
3. If the release exists, select **Link an existing supplier release**, enter its exact ID, reference the dashboard/support record, describe what matched, and confirm. The server verifies the ID exists and has not been bound to another order; the operator remains responsible for matching the actual customer/content. This records the ID and starts verification without submitting or changing billing.
4. Only if the supplier explicitly confirms the prior request was not accepted and cannot publish later, select **Supplier confirmed no submission — authorize one retry**. Record that confirmation and check the authorization. The order must remain paid, unrefunded, and backed by the original approved campaign and frozen payload. The submit gate must be enabled. The worker, not the form, sends the newly authorized attempt.
5. If the form says the order changed, refresh and inspect the current state before deciding again. If a response is lost, resubmit the unchanged form: its request ID is replay-safe. Do not edit records or clear dispatch markers directly.
6. For legacy orders without trustworthy frozen details or verified payment mode, arrange manual fulfillment or a customer refund. Never reconstruct missing approval/payment proof from guesses.

Reconciliation receipts and audit records retain the operator, supplier evidence reference, explanation, previous dispatch attempt, and outcome. Supplier cancellation and customer refunds remain separate actions. Linking a refunded order's existing release does not reverse that refund; inspect whether supplier cancellation is also needed.

## Background intelligence

Authenticated analysis and generation enqueue durable workspace jobs and return immediately. Customers can leave the page and resume from **Background work → Open results**. Local unconfigured analysis remains synchronous.

Run `POST /api/internal/jobs/run` on a production schedule with its bearer secret. Fulfillment, intelligence, and site diagnostics run independently; the response waits for all three and reports partial failures. Provide a runtime capable of the 300-second worker request allowance. Test the actual host timeout, rather than assuming the Next.js route setting changes the host plan.

Intelligence jobs use five-minute leases and at most three attempts. A changed project/campaign/order supersedes the result; a customer must review current work and start a new job. Failed jobs preserve existing content. Do not retry by copying job documents: use the normal analysis/generation action. These retries may incur model usage, so configure budgets and operational alerts before beta.

Deploy `firestore.indexes.json` before scheduling workers. Verify group queries for `jobs.status`, `intelligenceJobs.status`, `siteDiagnosticJobs.status`, and `orders.stripePaymentIntentId`, then set `FIRESTORE_INDEXES_VERIFIED=true`. Set `JOB_SCHEDULER_VERIFIED=true` only after observing scheduled processing and an interrupted-worker recovery in the deployment environment.

## Customer-site diagnostics

On a saved project, open **Brand Intelligence → Customer-site diagnostics**, confirm authority to inspect the public company site, then run the diagnostic. The server takes the URL from the saved project, not from the request body. No customer-site content is changed. Existing fulfillment orders do not prevent these observational reports and are never rewritten by this workflow.

The worker inspects at most four same-origin page candidates, a robots policy and two bounded sitemaps, with per-hop public DNS validation and connection pinning. It does not run JavaScript, follow cross-origin redirects, bypass access controls, or impersonate search engines. Unavailable robots policies stop page crawling conservatively. Reports distinguish recorded directives and apparent indexability from actual engine index inclusion, which remains **not checked**. Review limitations, errors and supporting snapshots before using a finding.

Jobs have five-minute leases and at most three attempts. A saved URL or request change supersedes stale results. The latest completed report remains available during new runs or failures; completion, report creation and the latest pointer are committed together. Report downloads contain bounded raw response excerpts, relevant headers/tags, timestamps, scope and hashes. They are customer-private evidence, not material to publish automatically. Configure retention/deletion and conduct an owner-authorized acceptance run before production availability.

## Pilot acceptance record

Record real outcomes for analysis, evidence correction, generation, approval, checkout, submission, editorial rejection, cancellation, partial/full refund, lost responses, duplicate requests, placement verification, and customer notifications. Keep supplier and customer refund outcomes separate. Current mocked/unit tests and isolated UI fixtures do not constitute this acceptance record.

## Assisted directory work

Use **Assisted directory operations** in `/admin` for provisioned directory tasks. Queueing requires a verified unrefunded payment and the unchanged approved campaign. Confirm customer authorization, required assets and eligibility before doing work in the directory's own interface. Queueing a task does not send a submission or authorize extra spending.

Record the submission and its evidence URL after performing the authorized manual work. Record acceptance or rejection separately. Publication requires the actual public listing URL and confirmation that its company/content match the approved campaign. Add an observation timestamp and an internal evidence note; customer-facing requirements go in the separate customer-actions field, never the private note.

Private notes and operator identity stay in admin-only journals. Customers see status, timestamps and recorded URLs, explicitly labeled operator-recorded rather than independently verified or indexed. Rejected, failed or removed tasks can be requeued after the payment/approval gate passes; prior evidence remains in the immutable audit trail. Historical outcomes can be recorded after a refund without reversing billing. Use separate supplier/customer refund controls when appropriate.

If another operator updated the task, refresh before deciding. Retry an unchanged form after a lost response to reuse its request ID. Never manually clear revisions or edit directory status fields in Firestore.

## Campaign history

Customers open **Version history** below the campaign editor, preview an earlier snapshot, and explicitly confirm restoration. Restoration creates a new draft and preserves previous versions. All assets need fresh review and approval. An existing fulfillment order, an active analysis/generation job, unavailable evidence, or a changed project invalidates restoration. Reload the project/history before retrying a conflict; never copy an old approval attestation onto restored content.

## Ordered-project editing boundary

Preparing fulfillment locks the project's evidence, company profile, claims, campaign assets, and approval. Cancellation, failed fulfillment, and refunds do not reopen editing: the order retains its frozen campaign and audit history. Read-only history, previews, source links and downloads remain available. Never delete an order or change project lifecycle fields to unlock it.

Confirmed order conflicts return HTTP 409, including when an authenticated recheck finds that an order won a concurrent edit. Failed rechecks preserve the original error and never retry the write. If order status cannot be verified, the UI temporarily pauses editing; restore connectivity and reload the project before retrying. The backend remains authoritative even if another tab shows older controls. Deploy the current `firestore.rules` and repeat target-environment integration checks before marking rules verified; a previous successful deployment or local test is not proof that the current rules are deployed.

If another session prepares an order while this tab has unsaved changes, the editor shows a conflict notice. Download the explicitly labeled **local draft** before choosing to discard local edits and reload saved content. A local draft is not proof of order content or approval. Reload requires confirmation; stale responses from earlier editor/project sessions cannot replace the current view.

## Reading dashboard outcomes

Publication counts are unique recorded URLs in published/indexed states, not a promise of an outlet total or independent editorial coverage. Supplier-reported indexing is not an independent search observation. Directory listings are counted separately from media placements. Failed refreshes preserve the last loaded records with a warning; absent records show dashes. A scheduled verification job is not proof the scheduler is running—verify the actual production worker separately.
