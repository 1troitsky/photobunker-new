# PB2 native Photo Browser — first integration slice

**Scope:** the previously fixture-only /browser screen now reads local PB2 photo headers + encrypted metadata via Gallery and the existing encrypted Assignments repository. The UI is independent from storage SDKs and encryption internals.

- Real personal/assignment folders with counts, searchable photos, grid/list and sort. Missing assignment rows are visibly unavailable, never silently reclassified as personal.
- Clicking a photo opens the existing PB2 private local viewer. No duplicate photo storage, new S3 copy, URL bearer grant or plaintext disk cache.
- Account/device switch invalidates results, with generation checks against stale async responses; scope established by the existing Identity and vault. Local Gallery already enforces expiry and ciphertext validation; Browser's wall-clock filtering is a display guard only.
- This view is **device-local**: it does not yet index cloud-only photos, shared collections, cross-account items or export/ZIP; it explicitly says so. Real recipient/server Browser remains blocked by R2-10 cross-account E2EE and dedicated ACL/TTL contracts. No claiming completion of R2-15.
- Legacy reference: compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue and PhotoBrowserView.vue. Adapt folder navigation, private labels and grid/list UX; reject old Workspace API, Matrix identity, client-only access inference, and export without PB2 server ACL.

Tests added for grouping, archive/missing assignment, expiration boundary, filter and deterministic ordering. **NOT RUN:** pnpm tests/typecheck/build and live device/DB checks in this connector-only edit. Security STOP from PR #39 still applies.
