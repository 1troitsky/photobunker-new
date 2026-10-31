# PhotoBunker client

Vue 3 / TypeScript application with a five-section Dock. U02–U03 built local UI first; B01–B04 connect the account UI to Identity, managed Matrix and account-owned workspaces. Open [localhost:8080](http://localhost:8080): **Camera → Try without a camera → shutter → Photos**. Presets are inside Camera; assignments are created directly in Assignments; reusable teams are inside Profile.

Native-style camera controls, preset CRUD/archive, filters, photo details/export/delete, a basic local version editor, task requirements/checklists/participants and contributor settings are implemented. An account is required to use the app; unauthenticated routes lead to sign-in. After sign-in, teams/tasks/presets and invitations use the authenticated workspace API; captures upload to personal or assignment Vaults. The server enforces independent membership, upload-only and restricted thumbnail access. Explicit import copies device/proven legacy data while preserving sources and clearing old textual grants. [B03 scenarios and limits](../../docs/operations/account-workspace.md). Existing server adapters remain for legacy records. Profile now supports key-based account creation/recovery, optional field visibility, exact-ID contacts/blocks and device revocation. One Matrix identity connects automatically when messaging is visited. B02 adds real E2EE direct/group chats, replies/read receipts, human-confirmed SAS and separate history-key backup/recovery. B04 adds independent PB4 photo recovery, strong read proof, a warm-session PIN, encrypted capture/outbox/scoped thumbnails/review, key rotation and verified device linking. Existing plaintext sources migrate only through explicit client encrypt/readback and separately confirmed cleanup. [Photo protection and limitations](../../docs/operations/photo-protection.md). [Messaging usage and limits](../../docs/operations/matrix-messaging.md). Categories are a workspace list independent of presets; only assignments may restrict allowed categories. [Identity boundaries and setup](../../docs/operations/identity-matrix-local.md). [Current status, storage and validation](../../docs/product/ui-through-u03.md).

```sh
# From the repository root; app dependencies run in the Linux container.
./scripts/dev web npm run check
```

For native development, use Node 22.12+ or 24+, `npm ci` and `npm run dev`.
`API_PROXY_TARGET` points Vite at Laravel. Install dependencies on the platform
where they run; macOS and Linux cannot share a `node_modules` installation.

## Prototype boundary

Development enables local capture. Production builds disable it unless built
with `VITE_LOCAL_PROTOTYPE=true`. This explicit flag is for local prototype
preview, not approval to release an unencrypted PhotoBunker. Default release
builds refuse to open the plaintext database.

The dedicated IndexedDB database `photobunker-local-prototype-v1` is separate
from the B04 encrypted queue `photobunker-encrypted-queue-v1`. Originals, thumbnails and metadata commit or
abort together. New binary records store byte buffers with MIME; legacy Blob records remain readable. This avoids the reproduced WebKit Blob-write stall without changing image bytes. Success is shown after transaction completion. A storage failure
retains the capture in memory for retry or explicit discard, and guards leaving
the page. Deletion/clear are atomic across the same three stores. Metadata edits
never replace original bytes. Clearing browser data can remove the library;
Unsent captures and local editor versions have no backup; there is no silent migration to B04 encrypted storage. Confirmed account uploads are separate server copies until their TTL.

Native `ImageCapture.takePhoto()` is preferred when available; unsupported
still capture falls back to a frame at the actual video dimensions. Details show
its source and resolution. Tracks stop on navigation, background and page hide,
including permission results that arrive after cancellation. Real iOS camera
quality, orientation, memory limits and installed-PWA behavior remain unverified. Continuous autofocus, zoom and torch use actual advertised track capabilities, never simulated controls. [Camera contract and device checklist](../../docs/operations/camera.md).

## Offline shell

`npm run build` writes `dist/sw.js` and the manifest/icons. Production registers
the worker on HTTPS or localhost; Vite development does not install it. To test
a local production preview, explicitly build with `VITE_LOCAL_PROTOTYPE=true`,
then run `npm run preview` and visit it online once before going offline.

Only the generated public asset list is precached. `/`, `/camera`, `/gallery`,
`/settings`, `/profiles`, `/profiles/new`, `/profiles/<uuid>` and `/gallery/<uuid>` can fall back to public HTML. Local copies use
IndexedDB; server-only photos require connectivity. API calls, storage URLs, user media, query strings and other origins
are never cached. No background upload is implemented. Updates wait for existing
clients to close and do not force a new build into an active session.

## Checks

`npm run check` runs component/lifecycle/cache/release-guard/API/library/preferences tests, TypeScript
validation and the production build. Actual Blob storage, process restart,
original-byte integrity, download and failure rollback are checked by the
repeatable browser script described in
[the local prototype runbook](../../docs/operations/local-prototype.md).

Legacy server photos use an explicit bearer header. Account photos use HttpOnly Identity sessions and expected-account headers; no URL credentials are issued. They are never written to the service-worker cache.
Server confirmation requires all required object writes and HEAD size checks before DB
visibility. Legacy failed upload retains the local original for retry; pending
metadata stays fixed until acknowledgement. Metadata edits use the revision the
user saw, so another browser's changes produce a visible conflict. Prototype
authentication is not the final proof-of-possession/recovery mechanism.

## Profile capture

Profiles persist on the local server, scoped to the current library. New captures
record an immutable profile snapshot, a short ID, category, shot-list item and
selected metadata. The client applies crop/contain, resolution and JPEG quality
before atomic storage; EXIF is rebuilt from the whitelist, with source thumbnails
removed. Encoder-added EXIF is stripped in every browser. GPS updates a sidecar
without replacing original bytes. Completed-field edit restrictions apply both
locally and in the API. See [profile workflow and limits](../../docs/operations/profiles-prototype.md).


Current access model supersedes the old guest/cold-PB4 UX: permanent device login, automatic photo recovery on trusted devices, optional PIN for the entire app, and expanded Matrix conversation actions. [ADR 0010](../../docs/adr/0010-persistent-device-login-and-application-pin.md), [usage and QA](../../docs/operations/messenger-actions.md). Historical plaintext adapters remain only for explicit migration. A public @username is unique and claimed when the profile is saved; other profile fields retain visibility rules.

B05: immutable encrypted cloud editor versions, offline draft status/retry, solid privacy masks/watermarks and isolated fragment-key external exports are implemented locally. See [editor/sharing operations](../../docs/operations/editor-sharing.md). Selected unavailable versions fail closed; no automatic fallback to originals.
