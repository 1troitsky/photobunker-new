# R2-11 — Image Editor and encrypted replacement: independent handoff

**Implementation branch:** `chatbot/r2-11-photo-editor`, stacked above R2-10 PR #39.
**Status:** Draft implementation; tests authored, NOT RUN; not Verified/Integrated/Accepted.

## Existing legacy evidence
Issue #12 records the required read-only inspection of `PhotoEditView.vue`,
`studio/render.ts`, `studio/geometry.ts`, `studio/versions.ts`,
`studio-model.test.ts` and `PhotoVersionController.php`.
The new module does not copy the legacy Workspace permissions, PB1 envelopes,
permanent version history or plaintext scratch repositories.

## User workflow and architecture
- Route `/photos/:photoId/edit` is reachable from the protected Photo Viewer.
- Responsive RU/EN Vue screen supports brush, pencil, annotation eraser,
  rectangle/ellipse/line, solid blackout, text entry with iOS keyboard focus,
  fill, color, width, opacity, brightness/contrast/saturation, compare,
  undo/redo, pointer gestures and unsaved navigation/reload safeguards.
- `editor/domain/document.ts`: validated bounded document and **ephemeral**
  undo history (up to 40 steps, no persistence; ST-07 remains OPEN).
- `editor/infrastructure/render.ts`: source-only in RAM, off-screen Canvas
  compositing, flattened JPEG, no EXIF or unencrypted temp writes. A separate
  JPEG metadata-header validator refuses APP1/XMP/comment attachments.
- `editor/application/editor.ts`: stable typed `openEditor`/`saveEditor`
  use-cases; Vue does not touch Dexie, S3 or raw account DEKs.
- Edited photos keep the ORIGINAL **capture** TTL (`expires_at`). Editor
  may only open/modify locally authorized photos with trusted time.
- Mode 2: source compressed original persists unchanged as a distinct
  encrypted asset; edited JPEG uses `kind:edit`. Later edits replace the
  prior edit (not the original).
- Mode 3: encrypted replacement `kind:master`. The new ciphertext is
  written, readback-verified and CAS-committed before the old local master
  and thumbnail are purged. Crash/reload `reconcile` completes cleanup.
  The server's old master/thumbnail become non-readable (`retiring`) in
  the same transactional pointer swap and are physically removed by the
  queue worker. Periodic maintenance retries abandoned retired-object
  cleanup after a worker outage.
- PhotoSync v1/v2 initial immutable signed contracts are **not rewritten**.
  New `photobunker.photo-edit.v1` signed command, revision-specific
  per-asset DEK/manifest, encrypted upload, SHA256 readback, CAS finalize,
  duplicate operation replay; old checksum/TTL unchanged.
- The new edit command is queued in the EXISTING encrypted photo outbox,
  ordered after original upload. A conflict remains local and is not
  silently overwritten; errors use bounded retries. Lost ACK reuses
  the same operationId.
- Cloud gallery manifests expose only currently active revisions. Remote
  rehydration recognizes newer protected edits from another device when
  no local unsynced operation exists. No unencrypted persisted cache.
- No native Photos/DCIM writes or export path. No Matrix/RTC.

## Data
- `2026_10_29_000007_create_photo_edits_v1.php` adds
  `photo_records.edit_revision / edit_asset_id`,
  `photo_objects.edit_operation_id`, and
  `photo_edit_operations_v1` for durable expected revision and signed
  idempotency. Server deletes edit operations on photo lifecycle cleanup.
- Down migrations destroy edit receipt history; never downgrade
  production data without backup/verified export and rollback plan.
- Server retains a `retiring` physical ciphertext object until deletion
  is independently verified. It is never served through protected reads.
  This is an explicit temporary cleanup state, **not** persistent version
  history.
- A local edit requires the initial encrypted upload already acknowledged;
  thus editing a newly captured *unsynced* offline photo is currently
  **not supported** even though edits to previously synced photos work
  offline. This is a functional limitation, not a hidden fallback.
- Cross-account Assignment/photo permissions remain safety-gated in
  upstream R2-10 PR #39. Current editor supports the author-owner only.

## Test inventory (authored; NOT RUN)
- `apps/api/tests/Feature/PhotoEditV1Test.php`: signed reserve→upload→
  finalize, unchanged TTL, mode2 original preserved, mode3 obsolete master
  denied, idempotent lost ACK, stale CAS, forged signature, wrong mode and
  expired photo.
- `apps/web/src/features/editor/domain/document.test.ts`: bounded
  undo/redo and transient model, input geometry, invalid drawing payloads.
- `apps/web/src/features/local-storage/infrastructure/jpeg.test.ts`:
  JPEG metadata/EXIF rejection, malformed/truncated input.
- `apps/web/src/features/local-storage/infrastructure/photo-edit.test.ts`:
  ciphertext-only local mode2/3 swap, original preservation, pending edit
  conflict, original-upload gate, scope changes, original metadata rejection.

**NOT RUN:** Composer/PHP lint/Pint/PHPStan, Laravel/Postgres migrations and
PHPUnit, pnpm install/TypeScript/Vue build/Vitest, Playwright HTTPS E2E,
Garage S3 consistency/cleanup fault injection, test of interrupted writes,
iOS Safari/Android PWA touch/pointer/keyboard, storage-full and complete
2-account security tests. GitHub branch/diff verification alone is not
an execution test.

## Remaining P0 gates before production acceptance
1. Run real backend/frontend and fix **all** failing typecheck, lint and
   scenario tests. Review the full upstream R2-08/09/10 stack.
2. Demonstrate by fault injection: crypto/readback failure before CAS
   leaves original intact; crash after CAS but before physical delete
   eventually purges old master/thumb; full disk and OPFS→IDB fallback;
   lost finalize ACK; concurrent tabs and competing device edit; stale
   revision 409; account switch mid-save and TTL crossing mid-upload.
3. Verify physical S3 removal, pending edit reservation reclamation and
   quota accounting under queue outages; monitor/stale-object alert.
4. Test cross-device remote rehydration while local changes are pending;
   resolve conflicts safely without discarding sole encrypted copies.
5. Confirm actual iOS/Android canvas JPEG output and pointer/text focus;
   benchmark large images, oversize rejection, portrait orientation,
   safe memory release and accessibility. Update thumbnail strategy:
   mode3 intentionally removes stale thumbnail, and new thumbnail
   generation is not yet implemented in this issue.
6. Clarify the owner decision ST-07 on editor history *after closing* the
   editor. Never silently enable endless versions.
7. Two-account grants and E2EE peers remain blocked in R2-10 PR #39.
   Do not misrepresent this editor as enabling Team photo editing.

**Do not merge until the stated critical checks pass.**
