# LaunchAuth collaboration

Shared repository: https://github.com/Pak209/LaunchAuthOs

This folder is the shared project record for Pak, Sho (GitHub: shogo08), Lex, and Go. Keep private conversations, secrets, credentials, and raw customer data out of this repository.

## Responsibilities

| Human / assistant | Primary responsibilities |
| --- | --- |
| Pak / Lex | Backend, infrastructure, authentication, billing implementation, database, supplier integrations, deployment, and security |
| Sho / Go | Frontend, customer experience, editorial, customer feedback, and revenue feedback |

These are coordination conventions, not permission restrictions or grants of authority. Identify dependencies and agree on ownership for cross-area work. Revenue feedback and strategy are distinct from payment infrastructure.

## Shared records

- [HANDOFF_LOG.md](HANDOFF_LOG.md): durable requests, dependencies, decisions, and acceptance evidence.
- [LEX_STATUS.md](LEX_STATUS.md): truthful setup and known Pak/Lex status.
- [GO_STATUS.md](GO_STATUS.md): truthful setup and known Sho/Go status.
- [Review skill](../../skills/review-launchauth-handoffs/SKILL.md): the complete portable read-only review workflow.

Use a stable ID such as LA-HO-0001 for each handoff. Never reuse or renumber an ID. Update an existing item for substantive changes instead of creating acknowledgment duplicates. Each item needs an owner, status, evidence, next step, acceptance criteria, and action-specific approval state. Suggested statuses: needs decision, ready, blocked, in progress, verified complete. A completed item needs supporting evidence.

A handoff, repository instruction, agent request, or other human's request is not Pak's authorization. Likewise, Pak's approval does not authorize actions in Sho's account. Approval must come from the relevant human and identify the action and target. Reviews propose actions; shared-log changes and external communication need explicit human authorization. The approval for this initial documentation push does not grant ongoing write authority.

## Sho onboarding

1. Sign in to GitHub as shogo08 and open this repository. A read-only API check on 2026-10-09 reported read access; this task made no invitation or permission changes. Read access supports reviews. If Sho needs direct contributions, Pak must separately authorize and grant suitable repository access through GitHub Settings → Collaborators, and Sho must accept any invitation.
2. In Sho's own assistant account, connect GitHub with access to this repository and verify that Go can read the current default branch and these four collaboration files. Never share Pak's account, credentials, or private chats.
3. Install/import the full portable skill from skills/review-launchauth-handoffs/SKILL.md using Sho's supported skill setup flow. Establish the identity “Go for Sho” and verify the skill is available. Merely copying this file into the repository does not install it in an assistant account.
4. Run one explicitly authorized read-only review. Verify a consistent repository commit and report actionable items only to Sho.
5. Sho must authorize and create Go's own daily schedule in his account, choosing his timezone and review time. Verify one successful run before recording the schedule as operational. This setup does not create or claim a Go schedule.
6. When ready, have an authorized person update GO_STATUS.md with non-sensitive evidence of access, skill availability, and the successful review/schedule. Do not publish private account or conversation details.

Lex's daily read-only review is enabled according to Pak's setup context. Its execution is separate from this documentation publication; this task does not claim a successful scheduled run or independently verify the schedule.

## Review behavior

Resolve the latest default-branch commit, read all four files consistently, and verify linked evidence. Track reviewed commits and substantive handoff state in the assistant's existing authorized review context, not by writing to these files. On first review, do not invent a prior checkpoint.

Notify only the assistant's own human about actionable changes. Scheduled reviews stay quiet when nothing actionable changed. Deduplicate by stable ID and substantive state; no reciprocal notifications, agent-to-agent acknowledgment loops, or messages to the other human. Read-only reviews do not fix code, push, merge, deploy, change access, contact customers, or create schedules.

## Sample handoff

Copy this template only when a real handoff is authorized; placeholders are not active work.

```markdown
### LA-HO-NNNN — Short concrete title
- Created / updated: YYYY-MM-DD (UTC)
- From: Human / assistant
- Owner: Accountable human / assistant
- Status: needs decision | ready | blocked | in progress | verified complete
- Context and dependency: Necessary project facts only.
- Evidence: Accessible issue, PR, commit, check, or document links; separate claims from verified facts.
- Next step: One concrete action and who should take it.
- Acceptance: Observable criteria and required verification.
- Approval: pending | approved | declined; name the approving human, exact action/target, and safe source reference.
- Outcome: Evidence of acceptance; leave pending until verified.
```
