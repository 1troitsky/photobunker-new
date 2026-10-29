<!-- R2 functional PRs only. Governance PRs may omit Closes. -->
Closes #<ISSUE_NUMBER>

**Roadmap ID / own scope:** R2-XX
**Implementation stage:** Implemented (Draft), **NOT VERIFIED** until independently tested.
**Current main SHA:** ...
**Upstream branch + SHA (if stacked):** ...
**Upstream PRs / dependency graph:** ...
**Head branch + SHA:** ...
**Merge-base:** ...
**Own diff:** `<base>...HEAD` (stacked PR: NEVER substitute `main...HEAD` for own scope)

## User-visible result / non-goals

**Before:**
**After:**
**Out of scope:**

## Legacy evidence (read from old GitHub read-only)

| Exact legacy path | REUSE / ADAPT / REFERENCE / REJECT | Decision / test vectors |
| --- | --- | --- |
| | | |

If the Issue did not contain Legacy evidence, document the narrow legacy-check in the original Issue before implementation.

## Replaceable UI / architecture contract

- [ ] Public typed feature API / commands and readonly view-state separated from Vue UI
- [ ] Application owns local-first, optimistic state, retries and rollback; UI does NOT import raw storage/crypto/HTTP SDK
- [ ] Domain logic, storage lifecycle, ACL/TTL and encryption unchanged by visual composition
- [ ] Design tokens/primitives and mobile/desktop presentation replaceable without rewriting business use-cases
- [ ] No prohibited cross-feature deep imports, cycles or global god-stores; existing exceptions documented
- [ ] No plaintext persistence / Photos/DCIM / Matrix / unsafe legacy migration

## Changed contracts / migrations / security

**Domain / API / DB / storage / encrypted bytes / ACL / TTL / account & key scope:**

**Migration/rollback/recovery and unchanged prior data:**

**What downstream Issues must know:**

## Checks ACTUALLY RUN (do not invent PASS)

| Command | Environment | Result PASS / FAIL / NOT RUN | Evidence |
| --- | --- | --- | --- |
| | | | |

**Explicit NOT RUN / security risks / known defects:**

**Device / production E2E deferred to final Codex integration:**

## Handoff / lineage

- [ ] current `main` and upstream SHA reverified
- [ ] entire **own** `base...HEAD` diff reread and unrelated changes removed
- [ ] upstream errors and carried corrections recorded
- [ ] exactly one Draft PR for this Issue, no force-push/merge/auto-merge
- [ ] status `Implemented — for final Codex review`, NOT `Verified/Integrated/Accepted`

**Codex after all Issues:** test/fix this PR, merge in dependency order, retarget descendants, rerun full-suite production/security/device gates.
