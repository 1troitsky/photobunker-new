# Assignment Release — compatibility runtime

**One canonical repository:** `photobunker-new`. This directory preserves the old PhotoBunker Vue/Laravel photo workflow as one isolated, temporary kernel. PB2 `apps/web`, `apps/api`, modular feature implementation (including the preserved #36–40 changes) remain separate. No PB1/PB2 account, ciphertext or session migration occurs.

**Workflow:** owner creates task (default target 30), invites contributor, contributor captures a real image with mandatory reported GPS accuracy <=30m, server-ACKed upload counts towards 0/30...30/30, authorized owner reads/reviews and editor saves a version. **This workflow has not been tested end-to-end after import.**

**Local Docker (isolated test data only):** from this directory `./scripts/dev setup`. The compatibility gateway defaults to `http://localhost:8081`, Garage host port `3901`; it has separate Compose name, DB and volumes. If legacy photo enrollment needs Matrix, run `./scripts/dev matrix`; messenger has no public navigation but old E2EE bootstrap dependencies remain. `./scripts/dev check` runs old checks; they are **NOT RUN** in this PR.

**Production front door:** build PB2 frontend with `VITE_ASSIGNMENT_RELEASE_ORIGIN=https://<separate-HTTPS-host>/`, serving this compatibility web+API on that dedicated host. PB2 redirects its user journey and does not start PB2 Identity or sync. This is a URL adapter, **not** a two-way API/identity integration. Do not point these runtimes at the same DB, keys, origin or storage. Disable this variable to revert PB2 navigation.

**P0 caveat:** legacy source quality and expired/revoked access are not verified here; PB1 mode/thumbnail/TTL rules differ from PB2. Preserved Draft #39 cross-account E2EE still has P0 STOP. Not production-ready without independent Codex remediation and real HTTPS camera/GPS/E2E acceptance. See [combined handoff](../../docs/ASSIGNMENT-RELEASE-CONSOLIDATION-HANDOFF.md).
