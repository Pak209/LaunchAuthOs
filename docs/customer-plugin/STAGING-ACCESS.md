# Staging access gate and deployment migration

Staging must set `DEPLOYMENT_ACCESS_MODE=restricted` and
`STAGING_ALLOWED_FIREBASE_UIDS` to the explicitly approved Firebase UIDs (comma
separated, maximum 10). Do not invent UIDs or use email addresses. Production or
hosted execution defaults to restricted; invalid modes also restrict access.

A trusted operator must separately create the server-owned Firestore document
`deploymentAccess/current` with `mode: restricted` and `allowedUids` containing
those same approved UIDs. Empty/missing/malformed policy denies access. Both the
server configuration and current database policy must permit a verified user.
Website session creation and every authenticated website API recheck the gate;
MCP applies it after signed issuer/subject mapping to an active Firebase user.
The exact Firestore rules also enforce the database policy on direct Web SDK/REST
requests. Clients cannot read or modify the policy. Operator IAM access is still
privileged and not governed by client rules.

**Migration requirement:** newly deployed rules require this document for every
project, including existing production. Normal production operation requires
explicit `DEPLOYMENT_ACCESS_MODE=standard` and a database policy with
`mode: standard`; deployed server access rejects missing or mismatched policy.
Do not deploy these rules to an existing project without a reviewed policy
migration. No live policy was created and no deployed rules were changed here.
Local non-hosted development/test mode retains ordinary authentication behavior.

A denied UID cannot create a website session or read/write app data. Restricted
login also omits self-signup, but **provider-level registration disabling is still
required** to prevent direct Firebase Auth signup/account spam. Approve and verify
`client.permissions.disabledUserSignup=true` where supported before rollout; if
this requires an Identity Platform upgrade or additional terms, stop for approval.
The runtime allowlist is defense in depth, not a substitute for that provider
setting. See the [provider configuration schema](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config#Permissions).

Missing Firebase configuration never enables local analysis in production or
hosted environments. Local analysis requires all of: `NODE_ENV=development`,
`LOCAL_DEMO_ANALYSIS_ENABLED=true`, no hosting markers, standard local mode,
loopback request URL and matching explicit Origin. Omit this flag in deployment.
Do not set a deployed runtime to development to obtain demo behavior.

Minimum staging approvals remain: region/database creation, Auth initialization
and provider signup restriction, real public Firebase configuration, exactly
approved test account creation, restricted policy/UID configuration, reviewed
rules/indexes and runtime identity access, followed by a separately approved
source upload/build/public URL. Keep MCP, paid services and workers disabled;
there is no test identity or credential embedded in source.
