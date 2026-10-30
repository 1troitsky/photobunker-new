# PB2 Native Integration Handoff — supersedes #41 runtime

## Result of this slice

- The old external compatibility origin redirect was removed from the PB2 router. PB2 initializes one Identity v2, one local encrypted photo vault, and its own photo/assignment/collaboration/grant workers independently of VITE_ASSIGNMENT_RELEASE_ORIGIN.
- The assignment-release navigation adapter now returns allowlisted local PB2 route paths only. It rejects unsupported legacy paths and all external URLs. No PB1 or Matrix session/bootstrap is required to navigate.
- Native PB2 account screen adapted from legacy Settings and AccountSecurity UX: account ID, server-backed current/revoked device listing, device revoke, logout, language, appearance, optional geolocation permission/preferences using PB2's single GPS service, links to PB2 photos/camera/assignments/contacts/teams and encrypted storage diagnostics. It does not import PB1 key stores/PINs.
- R2-11 editor: removed undefined lastPointer reference. A photo can now be edited and its new rendition durably encrypted while the initial encrypted capture is still queued offline. Immutable initial capture asset IDs are frozen before local mode-3 replacement. The original ciphertext must remain until initial upload ACK; worker defers sending edit to server until original upload has been acknowledged. No unsafe server-side CAS bypass. Tests for original snapshot IDs and internal-only native navigation.

## Legacy evidence and status

| Legacy code | PB2 destination | Status |
| --- | --- | --- |
| views/CameraView.vue, local/camera.ts | features/camera, local-storage | Native; complex rules/UX not fully ported |
| views/GalleryView.vue, photo-browser/* | features/gallery, photo-browser | Native; export parity not verified |
| views/AssignmentView.vue, studio/model.ts | features/assignments | Native; advanced legacy rules missing |
| views/ContactsView.vue, TeamView.vue | features/collaboration | Native; membership does not confer photo access |
| views/AccountSecurityView.vue, SettingsView.vue | features/account | Device/account/GPS/settings UX adapted; PIN/presence not ported |
| views/PhotoEditView.vue | features/editor | Offline save/build defects repaired; real tests NOT RUN |
| views/PhotoCardView.vue | features/photo-card | Native private card; recipient scopes incomplete |
| legacy identity, keys, Matrix bootstrap | none | REJECT: cannot share PB1 identity, ciphertext or Matrix |

The compat/assignment-release tree remains in the historical Draft as read-only evidence of work already done and test vectors. It is NOT mounted, imported or served by the PB2 runtime. Merely retaining it is not feature integration. Remove standalone compatibility runtime from release build once the old use cases have truly been ported and tested.

## Limits and open stop conditions

- This is NOT full legacy functional parity. PINs, emergency wipe, metadata/location policies, complete photo-card sharing, export, complex assignment rules and other legacy workflows require PB2-native migration and independent security review.
- Recipient thumbnail read capability is still disabled by server config pending two distinct real-account E2E and security review.
- One offline edit can be enqueued before original capture delivery. Repeated edits while an earlier edit is unacknowledged remain blocked to avoid unsafe server CAS ordering. Full offline revision chaining must be designed and verified.
- Both original PR #41 and this integration PR are Implementation Draft / NOT VERIFIED, with preexisting GitHub CI failures. No PB1 accounts, secrets, data or database are silently imported.

## Mandatory independent verification

Run locked pnpm install, lint, typecheck, Vitest, architecture, build and Playwright; PHP 8.4 Composer, PHPUnit, migrations. Confirm exactly one origin on every native route even if VITE_ASSIGNMENT_RELEASE_ORIGIN is set. On two genuine PB2 accounts test create/restore and device revoke, full offline capture/edit/reload, original-before-edit upload and CAS, expired/photo quota/concurrency handling, E2EE permission/grant/revoke and Safari/Android mobile. Do not merge before PASS. No full build or E2E was performed by this GitHub-only session.
