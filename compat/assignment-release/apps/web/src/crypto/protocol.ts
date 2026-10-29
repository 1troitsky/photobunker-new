import canonicalize from 'canonicalize'
import sodium from 'libsodium-wrappers'
export const SUITE = 'sodium-secretstream-xchacha20poly1305'
export const CHUNK = 1024 * 1024
export const MAX_OBJECT = 64 * CHUNK
export const MAX_META = 256 * 1024
export const utf8 = new TextEncoder()
export const text = new TextDecoder('utf-8', { fatal: true })
export const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  )
export function fail(): never {
  throw new Error('crypto.invalid')
}
function unicode(value: unknown, depth = 0): void {
  if (depth > 64) return fail()
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++i)
        if (!(next >= 0xdc00 && next <= 0xdfff)) return fail()
      } else if (c >= 0xdc00 && c <= 0xdfff) return fail()
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      unicode(key, depth + 1)
      unicode(item, depth + 1)
    }
  }
}
export function canonical(value: unknown): string {
  unicode(value)
  const result = canonicalize(value)
  if (result === undefined) return fail()
  return result
}
export function parseCanonical<T>(value: string, max = MAX_META): T {
  if (utf8.encode(value).length > max) return fail()
  const result = JSON.parse(value)
  if (canonical(result) !== value) return fail()
  return result
}
export const ready = () => sodium.ready
export const b64 = (value: Uint8Array) =>
  sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
export function unb64(
  value: string,
  length?: number,
  maximum = 200000,
): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    return fail()
  const result = sodium.from_base64(
    value,
    sodium.base64_variants.URLSAFE_NO_PADDING,
  )
  if (
    b64(result) !== value ||
    (length !== undefined && result.length !== length)
  )
    return fail()
  return result
}
export const hash = (value: Uint8Array | string) =>
  b64(
    sodium.crypto_generichash(
      32,
      typeof value === 'string' ? utf8.encode(value) : value,
      null,
    ),
  )
export const statementBytes = (purpose: string, value: unknown) =>
  utf8.encode(`photobunker/${purpose}/v1\0${canonical(value)}`)
export const signed = (purpose: string, value: unknown, key: Uint8Array) =>
  b64(sodium.crypto_sign_detached(statementBytes(purpose, value), key))
export function verify(
  purpose: string,
  value: unknown,
  signature: string,
  key: string,
) {
  if (
    !sodium.crypto_sign_verify_detached(
      unb64(signature, 64),
      statementBytes(purpose, value),
      unb64(key, 32),
    )
  )
    return fail()
}
export type KeyRecord = {
  version: 1
  accountId: string
  publicId: string
  authorityKey: string
  recipientKey: string
  pendingKey: string
  readKey: string
  revision: number
  previousHash: string
  recoveryId: string
  bundleHash: string
}
export type KeyDocument = {
  record: KeyRecord
  signature: string
  binding: { version: 1; accountId: string; authorityKey: string }
  rootSignature: string
  rootKey: string
}
export type DeviceCertificate = {
  statement: {
    version: 1
    accountId: string
    deviceId: string
    signingKey: string
    authorityKey: string
    expiresAt: number
  }
  signature: string
}
export type PlanMember = {
  accountId: string
  publicId: string
  role: string
  scope: 'none' | 'thumbnails' | 'all'
  key: KeyDocument
}
export type Plan = {
  version: 1
  vaultId: string
  ownerId: string
  assignmentId: string | null
  epoch: number
  taskRevision: number
  membershipHash: string
  validUntil: number
  members: PlanMember[]
  changesAllowed: boolean
  deletionAllowed: boolean
  sharingAllowed: boolean
  participantsOnly: boolean
  retentionSeconds: number
  startsAt: number | null
  finishesAt: number | null
  completed: boolean
}
export type SignedPlan = {
  statement: Plan
  signature: string
  authority: KeyDocument
}
export type ObjectKind =
  | 'original'
  | 'preview'
  | 'thumbnail'
  | 'metadata'
  | 'restricted-metadata'
  | 'gps'
  | 'review'
  | 'response'
  | 'version-metadata'
  | 'local-version'
  | 'profile'
export type Context = {
  vault_id: string
  asset_id: string
  object_id: string
  kind: ObjectKind
  object_revision: number
  encryption_epoch: number
}
export type Descriptor = Context & {
  format: 'pb-object'
  version: 1
  suite: typeof SUITE
  chunk_bytes: number
  plaintext_bytes: string
  frame_count: number
}
export type Recipient = { accountId: string; publicKey: string }
export type Envelope = {
  accountId: string
  fingerprint: string
  sealed: string
}
export type ObjectStatement = {
  version: 1
  descriptor: Descriptor
  descriptorHash: string
  ciphertextHash: string
  ciphertextBytes: string
  recipientEpoch: number
  wrappingRevision: number
  envelopesHash: string
  planHash: string
  accountId: string
  deviceId: string
  certificateHash: string
  initialHash: string
}
export type InitialProof = {
  statement: ObjectStatement
  signature: string
  certificate: DeviceCertificate
  plan: SignedPlan
}
export type Packet = {
  initial?: InitialProof
  statement: ObjectStatement
  signature: string
  certificate: DeviceCertificate
  plan: SignedPlan
  envelopes: Envelope[]
}
export type EncryptedObject = {
  blob: Blob
  statement: Omit<
    ObjectStatement,
    'accountId' | 'deviceId' | 'certificateHash' | 'initialHash'
  >
  envelopes: Envelope[]
  pending?: Envelope
}
export const packetString = (value: Packet) => canonical(value)
export function validateDescriptor(value: Descriptor) {
  const keys = [
    'format',
    'version',
    'suite',
    'vault_id',
    'asset_id',
    'object_id',
    'kind',
    'object_revision',
    'encryption_epoch',
    'chunk_bytes',
    'plaintext_bytes',
    'frame_count',
  ].sort()
  if (
    canonical(Object.keys(value).sort()) !== canonical(keys) ||
    value.format !== 'pb-object' ||
    value.version !== 1 ||
    value.suite !== SUITE ||
    !uuid(value.vault_id) ||
    !uuid(value.asset_id) ||
    !uuid(value.object_id) ||
    ![
      'original',
      'preview',
      'thumbnail',
      'metadata',
      'restricted-metadata',
      'gps',
      'review',
      'response',
      'version-metadata',
      'local-version',
      'profile',
    ].includes(value.kind) ||
    !Number.isSafeInteger(value.object_revision) ||
    value.object_revision < 1 ||
    !Number.isSafeInteger(value.encryption_epoch) ||
    value.encryption_epoch < 1 ||
    value.chunk_bytes !== CHUNK ||
    !/^(0|[1-9][0-9]{0,8})$/.test(value.plaintext_bytes)
  )
    return fail()
  const size = Number(value.plaintext_bytes)
  if (
    size > MAX_OBJECT ||
    (!['original', 'preview', 'thumbnail', 'local-version'].includes(
      value.kind,
    ) &&
      size > MAX_META) ||
    value.frame_count !== Math.max(1, Math.ceil(size / CHUNK))
  )
    return fail()
}
export function exact(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    canonical(Object.keys(value).sort()) !== canonical(keys.sort())
  )
    return fail()
}
export function checkKey(doc: KeyDocument) {
  exact(doc, ['record', 'signature', 'binding', 'rootSignature', 'rootKey'])
  exact(doc.record, [
    'version',
    'accountId',
    'publicId',
    'authorityKey',
    'recipientKey',
    'pendingKey',
    'readKey',
    'revision',
    'previousHash',
    'recoveryId',
    'bundleHash',
  ])
  exact(doc.binding, ['version', 'accountId', 'authorityKey'])
  const { record } = doc
  if (
    record.version !== 1 ||
    !uuid(record.accountId) ||
    !uuid(record.recoveryId) ||
    record.revision < 1 ||
    record.revision > 100000 ||
    !/^pb_[a-z0-9]{16}$/.test(record.publicId) ||
    !Number.isSafeInteger(record.revision) ||
    doc.binding.version !== 1 ||
    doc.binding.accountId !== record.accountId ||
    doc.binding.authorityKey !== record.authorityKey
  )
    return fail()
  if (
    record.authorityKey === record.readKey ||
    record.recipientKey === record.pendingKey
  )
    return fail()
  for (const key of [
    record.authorityKey,
    record.recipientKey,
    record.pendingKey,
    record.readKey,
  ])
    unb64(key, 32)
  unb64(record.bundleHash, 32)
  if (record.previousHash) unb64(record.previousHash, 32)
  if (
    (record.revision === 1 && record.previousHash !== '') ||
    (record.revision > 1 && !record.previousHash)
  )
    return fail()
  unb64(doc.rootKey, 91)
  verify('photo-key', record, doc.signature, record.authorityKey)
}
export async function verifyP256(
  purpose: string,
  value: unknown,
  signature: string,
  publicKey: string,
) {
  const key = await crypto.subtle.importKey(
    'spki',
    unb64(publicKey, 91) as Uint8Array<ArrayBuffer>,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      unb64(signature, 64) as Uint8Array<ArrayBuffer>,
      statementBytes(purpose, value) as Uint8Array<ArrayBuffer>,
    ))
  )
    return fail()
}
export async function checkRoot(doc: KeyDocument) {
  checkKey(doc)
  const key = await crypto.subtle.importKey(
    'spki',
    unb64(doc.rootKey) as Uint8Array<ArrayBuffer>,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      unb64(doc.rootSignature, 64) as Uint8Array<ArrayBuffer>,
      statementBytes('photo-authority', doc.binding) as Uint8Array<ArrayBuffer>,
    ))
  )
    return fail()
}
export async function checkPlan(
  plan: SignedPlan,
  expectedVault: string,
  current = true,
) {
  exact(plan, ['statement', 'signature', 'authority'])
  const legacy =
    !current &&
    !('startsAt' in plan.statement) &&
    !('finishesAt' in plan.statement) &&
    !('completed' in plan.statement)
  exact(plan.statement, [
    'version',
    'vaultId',
    'ownerId',
    'assignmentId',
    'epoch',
    'taskRevision',
    'membershipHash',
    'validUntil',
    'members',
    'changesAllowed',
    'deletionAllowed',
    'sharingAllowed',
    'participantsOnly',
    'retentionSeconds',
    ...(legacy ? [] : ['startsAt', 'finishesAt', 'completed']),
  ])
  await checkRoot(plan.authority)
  const value = plan.statement
  if (
    value.version !== 1 ||
    value.vaultId !== expectedVault ||
    value.ownerId !== plan.authority.record.accountId ||
    (current && value.validUntil <= Date.now()) ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    value.members.length > 101
  )
    return fail()
  if (
    !uuid(value.vaultId) ||
    !uuid(value.ownerId) ||
    (value.assignmentId !== null && !uuid(value.assignmentId)) ||
    !Number.isSafeInteger(value.taskRevision) ||
    value.taskRevision < 0 ||
    !Number.isSafeInteger(value.validUntil) ||
    value.validUntil < 1 ||
    !Number.isSafeInteger(value.retentionSeconds) ||
    (value.retentionSeconds !== 0 &&
      (value.retentionSeconds < 3600 || value.retentionSeconds > 1209600)) ||
    [
      'changesAllowed',
      'deletionAllowed',
      'sharingAllowed',
      'participantsOnly',
    ].some((k) => typeof value[k as keyof Plan] !== 'boolean') ||
    (!legacy &&
      (typeof value.completed !== 'boolean' ||
        [value.startsAt, value.finishesAt].some(
          (t) => t !== null && (!Number.isSafeInteger(t) || t < 0),
        )))
  )
    return fail()
  unb64(value.membershipHash, 32)
  verify(
    'capture-plan',
    value,
    plan.signature,
    plan.authority.record.authorityKey,
  )
  const seen = new Set<string>(),
    seenKeys = new Set<string>()
  for (const member of value.members) {
    exact(member, ['accountId', 'publicId', 'role', 'scope', 'key'])
    if (
      !['owner', 'curator', 'contributor', 'viewer'].includes(member.role) ||
      !['all', 'thumbnails', 'none'].includes(member.scope) ||
      (member.role === 'owner') !== (member.accountId === value.ownerId) ||
      (member.role === 'owner' && member.scope !== 'all') ||
      seen.has(member.accountId) ||
      member.accountId !== member.key.record.accountId ||
      member.publicId !== member.key.record.publicId
    )
      return fail()
    seen.add(member.accountId)
    await checkRoot(member.key)
    for (const field of [
      'authorityKey',
      'recipientKey',
      'pendingKey',
      'readKey',
    ] as const) {
      const key = field + ':' + member.key.record[field]
      if (seenKeys.has(key)) return fail()
      seenKeys.add(key)
    }
  }
  const owner = value.members.find((m) => m.accountId === value.ownerId)
  if (!owner || canonical(owner.key) !== canonical(plan.authority))
    return fail()
  if (!seen.has(value.ownerId)) return fail()
}
export function recipients(
  plan: SignedPlan,
  creator: string,
  kind: ObjectKind,
): Recipient[] {
  return plan.statement.members
    .filter((member) => {
      if (kind === 'review' || kind === 'response')
        return (
          member.accountId === creator ||
          member.role === 'owner' ||
          member.role === 'curator'
        )
      if (member.role === 'contributor' && member.accountId !== creator)
        return false
      return kind === 'thumbnail' || kind === 'restricted-metadata'
        ? member.scope !== 'none'
        : member.scope === 'all'
    })
    .map((member) => ({
      accountId: member.accountId,
      publicKey: member.key.record.recipientKey,
    }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId))
}
export async function checkPacket(
  packet: Packet,
  expected: Partial<Context>,
  allowLocal = false,
) {
  exact(
    packet,
    packet.initial
      ? [
          'initial',
          'statement',
          'signature',
          'certificate',
          'plan',
          'envelopes',
        ]
      : ['statement', 'signature', 'certificate', 'plan', 'envelopes'],
  )
  if (packet.initial) await checkInitial(packet.initial, packet.statement)
  const { statement, certificate, plan } = packet
  exact(statement, [
    'version',
    'descriptor',
    'descriptorHash',
    'ciphertextHash',
    'ciphertextBytes',
    'recipientEpoch',
    'wrappingRevision',
    'envelopesHash',
    'planHash',
    'accountId',
    'deviceId',
    'certificateHash',
    'initialHash',
  ])
  exact(certificate, ['statement', 'signature'])
  exact(certificate.statement, [
    'version',
    'accountId',
    'deviceId',
    'signingKey',
    'authorityKey',
    'expiresAt',
  ])
  if (
    statement.version !== 1 ||
    certificate.statement.version !== 1 ||
    !uuid(statement.accountId) ||
    !uuid(statement.deviceId) ||
    !Number.isSafeInteger(statement.wrappingRevision) ||
    statement.wrappingRevision < 1 ||
    !Array.isArray(packet.envelopes) ||
    packet.envelopes.length > 101
  )
    return fail()
  const seen = new Set<string>()
  for (const envelope of packet.envelopes) {
    exact(envelope, ['accountId', 'fingerprint', 'sealed'])
    if (
      !uuid(envelope.accountId) ||
      seen.has(envelope.accountId) ||
      envelope.sealed.length > 10000
    )
      return fail()
    seen.add(envelope.accountId)
    unb64(envelope.fingerprint, 32)
    unb64(envelope.sealed)
  }
  unb64(statement.ciphertextHash, 32)
  unb64(certificate.statement.signingKey, 91)
  validateDescriptor(statement.descriptor)
  if (
    Object.entries(expected).some(
      ([key, value]) => statement.descriptor[key as keyof Descriptor] !== value,
    )
  )
    return fail()
  if (
    statement.descriptorHash !== hash(canonical(statement.descriptor)) ||
    statement.envelopesHash !== hash(canonical(packet.envelopes)) ||
    statement.planHash !== hash(canonical(plan)) ||
    statement.certificateHash !== hash(canonical(certificate)) ||
    statement.recipientEpoch !== plan.statement.epoch
  )
    return fail()
  await checkPlan(plan, statement.descriptor.vault_id, false)
  const member = plan.statement.members.find(
    (member) => member.accountId === statement.accountId,
  )
  if (
    !member ||
    (member.role === 'viewer' &&
      !allowLocal &&
      statement.descriptor.kind !== 'response') ||
    certificate.statement.accountId !== statement.accountId ||
    certificate.statement.deviceId !== statement.deviceId ||
    certificate.statement.authorityKey !== member.key.record.authorityKey
  )
    return fail()
  verify(
    'capture-device',
    certificate.statement,
    certificate.signature,
    member.key.record.authorityKey,
  )
  const key = await crypto.subtle.importKey(
    'spki',
    unb64(certificate.statement.signingKey) as Uint8Array<ArrayBuffer>,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  if (
    !(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      unb64(packet.signature, 64) as Uint8Array<ArrayBuffer>,
      statementBytes('object-manifest', statement) as Uint8Array<ArrayBuffer>,
    ))
  )
    return fail()
}

export async function checkInitial(
  initial: InitialProof,
  current: ObjectStatement,
) {
  exact(initial, ['statement', 'signature', 'certificate', 'plan'])
  const s = initial.statement,
    c = initial.certificate,
    p = initial.plan
  if (
    s.wrappingRevision !== 1 ||
    s.initialHash !== '' ||
    current.wrappingRevision < 2 ||
    current.initialHash !== hash(canonical(initial)) ||
    canonical(s.descriptor) !== canonical(current.descriptor) ||
    s.ciphertextHash !== current.ciphertextHash ||
    s.ciphertextBytes !== current.ciphertextBytes ||
    s.descriptorHash !== current.descriptorHash ||
    s.accountId !== current.accountId ||
    s.recipientEpoch > current.recipientEpoch ||
    s.planHash !== hash(canonical(p)) ||
    s.certificateHash !== hash(canonical(c)) ||
    (p.statement.ownerId !== current.accountId &&
      p.statement.assignmentId === null)
  )
    return fail()
  await checkPlan(p, current.descriptor.vault_id, false)
  const member = p.statement.members.find((m) => m.accountId === s.accountId)
  if (
    !member ||
    member.role === 'viewer' ||
    c.statement.accountId !== s.accountId ||
    c.statement.deviceId !== s.deviceId ||
    c.statement.authorityKey !== member.key.record.authorityKey
  )
    return fail()
  verify(
    'capture-device',
    c.statement,
    c.signature,
    member.key.record.authorityKey,
  )
  await verifyP256(
    'object-manifest',
    s,
    initial.signature,
    c.statement.signingKey,
  )
}

export function checkCapture(plan: SignedPlan, actor: string) {
  const s = plan.statement,
    m = s.members.find((m) => m.accountId === actor)
  if (
    !m ||
    !['owner', 'curator', 'contributor'].includes(m.role) ||
    s.completed ||
    (s.startsAt !== null && s.startsAt > Date.now()) ||
    (s.finishesAt !== null && s.finishesAt <= Date.now())
  )
    return fail()
}
