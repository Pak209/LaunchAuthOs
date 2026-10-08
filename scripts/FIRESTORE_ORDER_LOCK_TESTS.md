# Local Firestore order locks and diagnostic jobs

Run these separate emulator suites after changing `firestore.rules` or diagnostic job transactions and before release. They do not
use `.env.local`, `.firebaserc`, Firebase Auth, a Firebase login, production data,
or the live Firebase integration suite. Passing locally does **not** establish
that these rules are deployed or set `FIRESTORE_RULES_VERIFIED=true`.

Prerequisites: the project's existing `npm ci` dependencies, Node.js supported by
Firebase CLI, Java 21+, and `firebase-tools` (verified with version 15.30.0). A
temporary CLI install is enough:

```sh
rules_tools_dir=$(mktemp -d /private/tmp/launch-rules-tools.XXXXXX)
npm install --prefix "$rules_tools_dir" --cache "$rules_tools_dir/npm-cache" --no-audit --no-fund --ignore-scripts firebase-tools@15.30.0
ORDER_LOCK_FIREBASE_CLI="$rules_tools_dir/node_modules/firebase-tools/lib/bin/firebase.js" \
  node scripts/test-firestore-order-lock.mjs
```

If Java is not on `PATH`, set `ORDER_LOCK_JAVA_BIN` to an absolute directory
containing a Java 21+ executable. A checksum-verified [Eclipse Temurin archive](https://adoptium.net/installation/archives)
can be extracted into a temporary directory without a system installation.
Optionally set `ORDER_LOCK_EMULATOR_CACHE` to an explicit temporary cache path to
reuse the emulator download across runs. No global npm or Java install is needed.

The launcher refuses occupied ports, creates an isolated temporary working
directory/config, and allows only the `demo-launch-order-lock` project. It binds
Firestore to `127.0.0.1:18891`, its websocket to `18892`, the emulator hub to
`18893`, and logging to `18894`; the UI is disabled. It clears inherited cloud
credentials, redirects SDK config discovery, and disables metadata-server
discovery. Firebase CLI starts/stops only its own emulator processes. Logs and
downloaded artifacts remain in the printed temporary paths; no user files are
deleted by the launcher.

The isolated Vitest configuration runs only
`tests/firestore-order-lock.integration.test.ts` and
`tests/firestore-site-diagnostics.integration.test.ts`. Ordinary `npm test` continues to
exclude integration tests. Running these tests against an unexpected host/project,
or without `RUN_FIRESTORE_ORDER_LOCK=1`, fails before constructing SDK clients.

Order-lock coverage:

- Direct client create/update/delete attempts against project, profile, claim,
  evidence, campaign, and campaign-version documents for every order status,
  including canceled/refunded orders and an order with no status field.
- Workspace owner/admin/member behavior, legacy fulfillment lifecycle/status
  locks without an order, orphan-parent recreation/deletion bypasses, and tenant
  isolation before/after ordering.
- Unlocked edits and cleanup, immutable evidence/version behavior, and a
  108-document normalized creation batch with 100 claims/four evidence records,
  followed by a 101-document edit batch to exercise cached rule access limits.
- Tenant denial and actual Admin SDK permission for operational fulfillment
  writes, plus a real optimistic Web SDK transaction racing an Admin order
  creation after the client transaction has read its initial state.
- The actual production `saveCampaignRevision` helper racing an Admin-created
  order after its callback stages writes but before the real SDK commits. A
  timing-only spy retains the real SDK transaction engine and verifies its
  `permission-denied` response becomes `ProjectMutationConflictError` (409), with
  original assets preserved and no new history version written.

Diagnostic-job coverage:

- Concurrent enqueue deduplication and worker claims using real Admin SDK transactions.
- Round-trip persistence of captured evidence and private job-field filtering, plus report resume through a fresh SDK connection.
- Expired-lease recovery with a late success or failure from the original worker; neither can overwrite the replacement worker's completed report.
- Last completed report retention during retries, URL changes and failed attempts; three-attempt limits and retry backoff.
- Revoked membership during a run, viewer read-only access, foreign project ownership, and tampered job/report bindings.
- Immutable report conflicts and preservation of approved/refunded order, campaign, claim, profile and approval records.
- Actual client rules denying reads, creates, updates and deletes for all four diagnostic record types, for both the owner and another user. The authenticated API is the intended access path.

The diagnostic suite supplies deterministic crawler output and advances its test clock to exercise leases. Database reads, commits, queries and transactions are not mocked. It cleans up only each test's generated workspace in the guarded demo emulator. It does not crawl a real site, test HTTP authentication, verify production indexes, or prove scheduler/deployment readiness. The existing launcher name and environment variables are retained for compatibility.

The suite uses the existing SDK's documented [`connectFirestoreEmulator` mock token option](https://firebase.google.com/docs/reference/js/firestore#connectfirestoreemulator)
and the Admin SDK's [emulator connection](https://firebase.google.com/docs/emulator-suite/connect_firestore#admin_sdks).
It does not substitute a serial in-memory database for Firestore rule evaluation
or transaction contention.
