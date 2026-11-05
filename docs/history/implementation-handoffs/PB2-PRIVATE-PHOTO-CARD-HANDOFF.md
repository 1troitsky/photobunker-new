# PB2 private Photo Card — implementation slice

The PB2 viewer and local gallery now link to a real \`/photos/:photoId/card\` owner-only screen.
Its application use-case opens existing scoped local vault ciphertext/metadata, rechecks
the active device/account at each asynchronous boundary and makes a pure domain
projection. It validates captured/expiry policy before showing metadata. Expiry and
tombstones remain enforced by \`LocalPhotoVault\`, not the Vue route.

Displays title or pending NAME-ID, capture time, expiry, dimensions, mode, assignment
binding and local sync status. GPS is hidden until the viewer explicitly expands it;
copy is explicitly user initiated. No external map queries, no origin tokens, no
plain metadata cache, no automatic Photos/DCIM write.

**Security boundary:** this is NOT a public Photo Card. It does not grant
\`card/image/original/download/metadata\` capabilities or generate links. Public
links, read grants and two-account cross-envelopes stay blocked on the R2-10
security P0 and will require a server-specific ACL and expiry gate. It
does not reuse legacy Workspace/Matrix contracts.

Legacy UX reference: \`compat/assignment-release/apps/web/src/views/PhotoCardView.vue\`,
adapt its private details/expiration/opt-in location. Reject PB1 share ACL and
external link flows until the PB2 protocol is verified.

Tests authored for basic projection and assignment/TTL consistency.
**NOT RUN:** pnpm build, unit tests, browser/real-device E2E, PHP and security review.
