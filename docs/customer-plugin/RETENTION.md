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
  Those must be removed separately. A full project/account deletion workflow is
  not exposed by this milestone, because paid/approval/report policy remains
  undecided and recursive deletion needs its own reviewed operational workflow.
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
