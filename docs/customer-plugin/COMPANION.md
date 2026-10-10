# Guided launch companion — local slice, 2026-10-10

This extends the initial read-only prototype. Nothing has been committed,
deployed, connected to ChatGPT or provisioned in live infrastructure. The code is prepared for the approved separate review branch.
MCP remains disabled unless `CUSTOMER_MCP_ENABLED=true` is explicitly configured.

## Working slice

Open `/companion` from the website's **Guided brief** link. Start without a URL
or open an existing owned project with `/companion?project=<id>`. The brief coach
asks deterministic questions and branches on missing company/angle/audience/
goal/CTA/facts. The content editor is another scripted stage, not an autonomous
agent. Holobots practice provides prompts, not invented product facts or dates.

The brief includes company, product, announcement angle, goal, audience, tone,
CTA, optional announcement date/embargo, required/excluded facts and references.
Saved briefs autosave after editing pauses; their URL resumes the saved revision.
Before first save, edits exist only in the page. Failures preserve edits and
pause autosave. A recovery button explicitly reloads saved content, discarding
unsaved edits. Existing website Firebase authentication is required for saving;
unavailable Admin storage returns an honest 503, without pretending to upload.

Facts can be added, edited or removed. Claims begin unapproved. Customer approval
is not independent verification. Changed text/reference/type or source excerpts
clear relevant approval (source changes clear all facts); assumptions cannot be
approved as facts. Each brief/fact-approval change records a revision and
invalidates the campaign's approval with a new draft version. Legacy evidence
and campaign editors reject brief-managed projects; use the guided editor to
avoid two conflicting approval/version histories. Reanalysis is likewise blocked.
Explicit existing backend generation remains separate and receives the validated
brief plus approved factual claims and milestone/proof-point context. Raw source
excerpts are excluded from that backend generation input.

## Text intake and privacy boundary

Supported: `.txt` and `.md`, MIME `text/plain` or `text/markdown` (empty MIME is
accepted for browsers that omit it), valid UTF-8, 1–8192 bytes/file, at most 8000
characters after normalization, five sources and forty facts. Filenames are
bounded to 120 characters. Files are parsed as inert text, with no Markdown/HTML
execution. HTML/script signatures, binary/control bytes, malformed UTF-8 and
common credential patterns are rejected. Server schemas repeat the checks, so
client validation cannot bypass them. Credential detection is basic pattern
checking, not a guarantee that arbitrary sensitive prose is recognized; users
must review and omit secrets/private data before saving or exporting.

Only normalized text excerpts are stored in the existing owned Firestore project
only; new brief history snapshots omit source text. There is no raw object/blob upload, new storage account,
remote URL fetch, file execution, external vendor upload or model call. Source
removal followed by a successful save clears current and legacy stored source
history copies atomically. Legacy projects above the bounded migration limit
fail closed for separate operator review. Derived facts and saved draft wording
remain separate content and need separate removal. See RETENTION.md for approved
defaults and protective exceptions; no live scheduler is enabled.
PDF, images, archives and executable agent scripts are deliberately unsupported.
Do not advertise these as working uploads.

Preparing context is a user action. It exposes the brief, approved facts,
separate assumptions and up to 1200 characters per source. The user reviews and
copies/downloads it for a ChatGPT conversation. Content is labeled untrusted
reference data, never instructions. Prompts prohibit invented facts, dates,
metrics, quotes or outcomes. Draft JSON may be pasted back; saving makes a new
unapproved campaign version. Up to eight unique asset types, 12000 characters
per asset, and only currently approved fact IDs are accepted. Incomplete content
sets are useful drafts; existing fulfillment completeness/payment gates remain.

Website-only users can export the compact JSON context and paste draft JSON.
Their unsaved draft editor text remains only in the page until **Save imported
draft for review** is pressed. Saved campaigns are resumed from the server.
No ChatGPT credentials or subscription tokens are relayed. Ordinary API usage is
separate. Official participating-app plan usage may be a future integration,
subject to eligibility and a separately approved implementation; nothing here
enables or promises that integration.

## Companion tools and scopes

| Tool | Scope | Effect |
| --- | --- | --- |
| `list_launch_projects` | `launch:projects:read` | Read own project summaries |
| `get_campaign_status` | `launch:status:read` | Read campaign and job states |
| `get_placement_report` | `launch:reports:read` | Read bounded recorded placements |
| `get_launch_brief` | `launch:brief:read` | Read brief, approved facts, assumptions and bounded source excerpts |
| `get_saved_campaign` | `launch:brief:read` | Read saved content/version and brief revision |
| `save_campaign_draft` | `launch:drafts:write` | Save or revise supplied content as an unapproved version |

Draft mutations require a separate write scope. They accept no arbitrary user ID
and cannot approve facts/campaigns, start generation, purchase or distribute.
The tool conservatively declares `readOnlyHint=false`, `destructiveHint=true`
because it replaces the current draft, and `idempotentHint=true` because retries
with the same UUID/payload return the original receipt. Different content under
the same UUID is rejected. Expected campaign version and brief revision protect
against concurrent/stale writes. Each mutation rechecks membership/ownership and
permanent order freeze in the same transaction. Canceled/refunded orders remain
frozen. Duplicate retries do not override a later campaign; frozen projects reject
mutations, including retries. Website approval requires explicit confirmation and
matches the exact current campaign version/digest before writing its attestation.

Routes: `/api/mcp`, `/.well-known/oauth-protected-resource/api/mcp` and authenticated
website `GET/POST /api/companion/[projectId]`. Website POST requires an exact trusted
Origin and JSON; bodies are capped at 160 KB. MCP bodies are capped at 160 KB.
No payment/pricing/checkout links, upsells, admin or supplier tools are exposed by
MCP. The companion has standalone drafting/management value; website commercial
flows remain separate and unchanged.

## Live work still blocked

OAuth provider/client setup, verified account linking, staging hostname/Firebase
selection, hosting and ChatGPT grants still need approval. Recommended Auth0
pilot details are in `PROVIDER-DECISION.md`; add `launch:brief:read` and the optional
`launch:drafts:write` permission to its previous read-only configuration. Decide
retention/deletion, write quotas/rate limits, customer consent and support before
production. No paid plan or provider setup was performed. Real Firestore indexes,
security rules/emulator behavior, OAuth and ChatGPT tool selection still need
integration testing. The browser QA uses local intercepted mock API responses.
