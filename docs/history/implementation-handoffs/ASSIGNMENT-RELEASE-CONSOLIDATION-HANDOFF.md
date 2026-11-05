# Assignment Release — combined implementation handoff (Draft / NOT VERIFIED)

## Git history and intended ownership
- Target: `main` at `d2b9f58b507fa5cd32f8461d5248c871ad1a816e`.
- Source A: `chatbot/assignment-release-legacy-kernel` at `3a0b1fd538a48143602942cb8802f6a8f225a3bf`, 39 changesets.
- Source B: `chatbot/r2-11-photo-editor` at `619fc8bed1e9d98f979b56b5754a1dd9294afb28`, descendant of the Draft #36 → #38 → #39 → #40 chain.
- The combined branch intentionally retains both histories. The old Draft PRs are evidence and remain unmerged; `main` is never modified by ChatGPT.
- Existing PB2 runtime takes precedence unless `VITE_ASSIGNMENT_RELEASE_ORIGIN` explicitly opts into a **different, separately served compatibility origin**.

## What is preserved, and what is not yet migrated
- `compat/assignment-release/` snapshots the old Vue/Laravel/Identity/photo/editor work, independent Docker/DB/S3 and regression/test sources. It is **not** a replacement for the PB2 application or a production deployment.
- PB2 retains its anonymous key-only Identity, Dexie/OPFS, photo sync, assignments, collaboration, assignment capture/review and editor from the Draft stack, with its native routes and non-blocking workers.
- PB2 → compatibility navigation is a public typed URL adapter, **not an authenticated session/key bridge**. Do not assume the two account IDs, keys, sessions or photos interoperate. Do not send tokens or recovery keys between origins.
- The legacy shell still contains Matrix-coupled photo key enrollment internally. This is historical compatibility code, not a request to add chat/RTC to PB2. It must be removed during subsequent porting and independently security-reviewed.
- In particular R2-10 / PR #39 remains `PARTIAL / P0 STOP`: cross-account photo DEK distribution, recipient acceptance and full ACL are not complete. R2-11 is downstream of this unresolved requirement. **Do not deploy or merge as verified**.

## Integration contract for Codex
1. Treat PB2 feature `domain/application/infrastructure/ui` modules, ACL/TTL and `docs/11–14` as authoritative. Port only verified legacy UX/use cases into them; avoid rewiring PB2 back to legacy Identity/Matrix/Workspace.
2. First resolve #39 cross-account key delivery, recipient decrypt/review and grant/revoke lifecycle with two distinct real accounts, signed snapshots and secure key envelopes. No plaintext keys/unauthorized originals; deny and expire server-side independently of UI.
3. Replace compatibility-origin navigation with native PB2 screens only when their flows truly work. Retain the compatibility tree as evidence until its remaining behavior/assets are classified and validated. Do not silently migrate existing ciphertext/accounts without an explicit crypto/data migration.
4. Test PB2 `pnpm install --frozen-lockfile && pnpm check && pnpm test:browser`; separately test legacy `npm install --prefix compat/assignment-release/apps/web && npm run release:legacy:build && npm run release:legacy:test`. Run PHP checks/migrations separately against disposable DB, including the compatibility API. These commands are **NOT RUN** in this GitHub-only assembly.
5. Then test production HTTPS capture, strict GPS, two-account encrypted sharing and real recipient acceptance, editor 2/3 crash recovery, offline/reload, Safari/iOS, PIN/revoke, expiry, idempotency, failed sync, account switch and browser boundary. Verify `main...HEAD` fully and resolve any build/CI failures **before** integration.

## Explicit state
**Assembled Draft — NOT TESTED / NOT VERIFIED / NOT INTEGRATED / NOT RELEASED.** The source union is not evidence that the old application has been fully refactored into the new architecture. This handoff prevents false acceptance while ensuring none of the two code histories is discarded.

## REUSE / ADAPT / REJECT — specific source mapping

- **REUSE together, not cherry-picked:** original `photobunker@0c5062d` `apps/web/src/{identity,crypto,studio,workspace,collaboration,local,profiles,views}/**`; `apps/api/app/{Identity,Encrypted,Workspace}/**`, old controllers, routes, tests and DB migrations, `infra/**`, Compose and setup scripts. All live inside `compat/assignment-release`, keeping their own PB1 dependencies.
- **ADAPT:** `studio/model.ts` defaults assignment count to 30; `views/AssignmentsView.vue` and `AssignmentView.vue` count server-confirmed photos/receipts only; `views/CameraView.vue` requires a fresh <=30m GPS fix and live camera before assignment capture; `App.vue` removes Messenger/Profile from main dock; `router.ts` hides public Messenger and provides internal `/_compat/photo-bootstrap` for old Matrix-backed photo-key setup; standalone Compose ports and volumes are isolated from both originals. QA source `check-photo-workspace.mjs` points at the private bootstrap route and still needs live-camera acceptance.
- **REJECT:** importing PB1 user IDs/ciphertext into PB2 `identity/v2`, replacing PB2 `photos/v1` with old routes or DB tables, treating Team membership as key access, silently closing #39 P0, combining both photo outboxes in one runtime, claiming no Matrix dependency or full PB2 mode/TTL compliance.
- **Not yet achieved:** the old application has not been internally refactored to PB2 module architecture; it operates behind a typed **launch adapter and separate origin**, without an authenticated API/key bridge. Next Codex pass must first prove two-account E2EE on one runtime, then migrate supported use-cases into PB2 domain/application/infrastructure/ui behind tested adapters. No invented PASS.
- **Assets/toolchain:** original Composer/npm lockfiles and old brand/PWA icons were preserved; `./scripts/dev setup` inside `compat/assignment-release` uses independent Docker project and 8081/3901 defaults; Matrix remains optional compatibility service unless the photo bootstrap requires it. Do not run old migrations on PB2 DB.
