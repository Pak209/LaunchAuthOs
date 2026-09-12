# Supplier Matrix

Status: **PILOT CANDIDATE SELECTED — PRNOW ADAPTER IMPLEMENTED; ACCOUNT/CONTRACT VALIDATION REQUIRED**

This matrix will compare PRNow, Press Ranger, RedPress, ACCESS Newswire, and other API-first, reseller, wholesale, or white-label providers.

| Provider | Wholesale/reseller price | API/docs | White-label | Exposure classification | Turnaround | Restrictions | Reporting | Evidence/source |
|---|---|---|---|---|---|---|---|---|
| PRNow | $21.75/release at 10+ credits; reseller tiers advertise lower per-credit rates | Public REST API for submit, status, links/report, and pending retraction | Yes; reports/publications/custom domain claimed | Terms guarantee distribution but disclaim publisher publication; pricing page separately advertises publication/refund | Average 5 hours, up to 24 hours advertised | Public editorial rules; restricted topics vary by package | Link/report endpoints; package-level rejection/refund state documented | [API](https://prnow.io/api-docs), [pricing](https://prnow.io/pricing), [terms](https://prnow.io/terms), [refunds](https://prnow.io/refund-policy), [editorial rules](https://prnow.io/editorial-guidelines) |
| Press Ranger | Retail $299 Premium / $399 Gold; wholesale rate requires inquiry | API availability UNKNOWN | White-label reports; branded reports | GUARANTEED PLACEMENTS advertised; contractual scope UNKNOWN | UNKNOWN | Writing/approval guide referenced | White-label reports; AI visibility report advertised | [resellers](https://pressranger.com/docs/playbooks/resellers), [pricing](https://pressranger.com/pages/pricing), [distribution](https://pressranger.com/pages/wholesale-press-release-distribution) |
| RedPress | Wholesale price/tier discount advertised; amount UNKNOWN | API UNKNOWN | White-label PDF reports advertised | DISTRIBUTED; “instant delivery” does not establish publication guarantee | UNKNOWN | UNKNOWN | Branded PDF reports claimed | [white-label](https://redpress.net/white-label-press-release-distribution) |
| ACCESS Newswire | Partner pricing by quote | API access advertised for partners; docs UNKNOWN | Co-branded reseller program; ACCESS attribution in dateline | DISTRIBUTED across ACCESS wire network; individual outlet guarantee UNKNOWN | UNKNOWN | UNKNOWN | Partner reporting UNKNOWN | [partner program](https://www.accessnewswire.com/solutions/resellers-publishers-and-market-research) |

## Pilot decision

PRNow is the provisional controlled-beta candidate because it is the only reviewed low-cost reseller provider with public documentation for the lifecycle the MVP needs: API-key validation, submit, status, link evidence, package-level rejection/refund details, and pending retraction. The adapter is implemented behind `PRNOW_SUBMIT_ENABLED=false`; this is not contract approval or authorization to spend credits.

Before enabling it, Launch Auth must run a single low-cost account pilot and obtain written clarification for the material conflict between the public pricing language (“guaranteed publication”) and the terms, which guarantee distribution but state that publisher publication remains editorial. Public documentation also does not promise idempotent submission. Accordingly, the worker never automatically retries an ambiguous submit response; it stops for human dashboard reconciliation.
