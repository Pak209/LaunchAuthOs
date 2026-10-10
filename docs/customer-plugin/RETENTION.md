# Approved companion retention defaults — implementation boundary

Pak approved code implementation and a review-branch push. No live cleanup,
security/TTL setting, backup expiry, scheduler, or deployment was authorized.

- Source text: keep while active, then eligible 30 days after archive. Explicit
  source removal and successful brief save clears source-history copies now.
  New history never embeds sources. Existing source-bearing prototype histories
  up to 50 revisions are scrubbed in the same transaction; larger legacy sets
  fail closed for a separately reviewed migration. Failed saves do not claim deletion.
- Current brief, facts and saved drafts: no age-based deletion; retain until
  project deletion. Source removal does not erase derived facts or draft wording.
  Those must be removed separately or through confirmed draft-project deletion.
  Full account deletion and protected-project deletion remain blocked pending
  paid/approval/report policy and a reviewed cross-system workflow.
- Brief and campaign revision history: eligible after 30 days. Current project
  and current campaign are retained independently of history snapshots.
- Companion operational logs: 30 days. Only a fixed event name and timestamps;
  no raw customer content, tokens, arbitrary errors or provider response bodies.
  This does not retroactively govern platform logs, legacy supplier audit logs,
  external provider logs, or backups. Those settings remain unverified/unchanged.
- Paid orders, approvals and reports: retention is undecided. Any order (including
  canceled/refunded), approval record, approved campaign/version, placement or
  diagnostic report holds ALL source/history cleanup for that project. No fixed
  paid-record term or blanket erasure promise. Operational event cleanup remains
  eligible because it contains no record payload.
- Backups: expiry undecided. No promise of immediate erasure or fixed expiry.
  Before live deletion, inventory backups/exports and design restoration replay
  of a deletion ledger to avoid resurrecting deleted content.

`applyCompanionRetention` defaults to dry-run. Explicit execution processes at
most 50 records per history/log collection per call and rechecks ownership and
protected records transactionally. Re-run reviewed batches until no candidates
remain. There is NO HTTP route, CLI, scheduler, database TTL configuration or
production invocation for this maintenance function. Dates describe eligibility,
not an assertion that an unscheduled job already deleted records.

Website archive/restore is an authenticated owner operation with revision
concurrency checks. Archive freezes edits and generation; restore cancels pending
source expiry. Existing orders prohibit archiving. Normal reads remain available.
Client Firestore rules deny direct guided-project writes/deletes and campaign
writes so users cannot bypass server-side approval or retention state. These
rules are source changes only and must pass approved target acceptance before
release. Existing non-guided projects keep their earlier rule behavior.

Synthetic emulator evidence covers active/archive/restore behavior, explicit
execution versus dry-run, source-history removal and oversized migration refusal,
current draft preservation, log content/expiry, protected-record holds, tenant
isolation and direct-client bypass denial. Live cleanup and backup semantics are
not validated by these tests.

## Confirmed draft-project deletion

The website now offers an explicit draft-only deletion action. The owner types
`DELETE <project ID>` and acknowledges removal of derived facts/drafts. The
server checks owner membership, exact project ownership and the displayed brief
revision/campaign version. A successful transaction removes the bounded project
and known source/fact/draft/history/log records from active Firestore storage.
Deletion is not an MCP tool and is never triggered by retention maintenance.

The operation is all-or-nothing: maximum 100 child documents, conservative 2 MB
payload budget, no recursive purge. It blocks legacy URL projects, any order,
approval or approved version, report/placement, linked job/request, unknown
collection/descendant, orphan-parent tree or oversized project. Blocked projects
are not partially erased. Those need an independently reviewed deletion plan.
Concurrent normal app edits contend with deletion. Unexpected out-of-band Admin
SDK writers are not covered by a client security boundary; pause administrative
migrations before any eventual live deletion rollout.

A server-only marker (owner UID, project ID, deletion time) remains outside the
project to recognize retries and prevent recreation. It contains no customer
source or draft content and has no automatic expiry; its disposition belongs in
the still-pending account-deletion/restore policy. Repeat calls recheck ownership
and confirm that no project tree remains. Interrupted pre-commit calls remove
nothing; a lost success response can be retried. Reopening a deleted project
returns HTTP 410, allowing the page to clear stale locally displayed content.

Saved derived draft/fact content is removed with project deletion, while removing
only a source still leaves derived content. Downloads, pasted ChatGPT content,
external systems and backups are outside this active-storage operation.

Full account deletion deliberately remains blocked (HTTP 409; no queue or
mutation). Essential owner decisions: retain, anonymize or delete paid-order,
approval and report records, and for how long; who handles external provider
identity/grant removal; how backup restoration replays deletion markers. Until
that policy and a tested cross-system identity workflow exist, neither the UI nor
API claims to erase the Firebase account, OAuth mapping or all personal data.
