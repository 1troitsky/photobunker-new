import { bindCalls } from '../calls/store'
import * as workspace from '../workspace/api'
import { computed, ref, shallowRef, watch } from 'vue'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import type {
  GeneratedSecretStorageKey,
  VerificationRequest,
  Verifier,
  ShowSasCallbacks,
} from 'matrix-js-sdk/lib/crypto-api'
import {
  account,
  deviceId,
  connectMatrix,
  loadIdentity,
  hasConfirmedIdentity,
  sessionState,
  offlineCaptureIdentity,
} from '../identity/store'
import { appLockReady, appLocked } from '../app/lock'
import { identityRequest } from '../identity/api'
import { storageKey, markCryptoReady } from './keys'
import { accountKey, readAccountSecrets, saveAccountSecrets, roomKeysSavedLocally } from '../identity/vault'
import { canUseMessagingDevice, initializeMessagingIdentity } from './onboarding'
import { m, type MessageText } from './text'
import { ui } from './presentation'
import { encryptVoice, decryptVoice, voiceContent, maxVoiceBytes, maxVoiceDuration, type VoiceDraft, type VoiceMessage } from './voice'
import { voiceText } from './voice-text'
import { prepareAttachment, encryptAttachment, decryptAttachment, attachmentContent, MAX_ATTACHMENT_BYTES, type ChatAttachment } from './attachment'
import { retrySignedEvent } from './trusted-decryption'
import { visiblePendingText, type PendingText } from './optimistic'
import { saveDurableText, readDurableText, eraseDurableText, type DurableText } from './durable-outbox'
import { retryDelayMs, isTransientMessageError } from './retry-policy'
import { summarizeReactions, isReactionKey, type ReactionKey, type ReactionRecord, type ReactionSummary } from './reactions'
export type Peer = {
  username?: string | null
  publicId: string
  matrixUserId: string
  ready: boolean
  fields: { name?: string; username?: string }
}
export type Chat = {
  id: string
  name: string
  membership: string
  encrypted: boolean
  direct: boolean
  members: { id: string; name: string }[]
  blocked: boolean
  unread: number
  archived: boolean
  deleted: boolean
  muted: boolean
  preview: string
  lastTime: number
  lastMine: boolean
}
export type Message = {
  id: string
  sender: string
  mine: boolean
  body: string
  time: number
  status: 'queued' | 'sending' | 'sent' | 'read' | 'notSent'
  reply?: string
  photoId?: string
  locked: boolean
  voice?: VoiceMessage
  attachment?: ChatAttachment
  edited?: boolean
  reactions?: ReactionSummary[]
  decryptionFailure?: string
}
export const connection = ref<
    | 'idle'
    | 'connecting'
    | 'ready'
    | 'offline'
    | 'otherTab'
    | 'error'
    | 'unsupported'
  >('idle'),
  failure = ref<MessageText>(),
  rooms = ref<Chat[]>([]),
  peers = ref<Peer[]>([]),
  selected = ref(''),
  messages = ref<Message[]>([]),
  busy = ref(false)
// UI-only indicator for an uncreated direct conversation in the phone shell.
export const pendingConversationUi = ref(false)
// UI-only decrypted projections; the durable outbox stores AES-GCM ciphertext
// (never browser plaintext storage). Matrix server events remain authoritative.
const optimisticText = new Map<string, PendingText>()
export type PendingDirectText = {
  id: string
  txnId: string
  peerId: string
  body: string
  time: number
}
export const pendingDirectTexts = ref<PendingDirectText[]>([])
export const outboxError = ref(false)
let outboxRestoredScope = ''
let directOutboxRestoredScope = ''
let visibleDirectScope = ''
// A read started before a peer row is bound may resolve with that old row.
// Keep it out of the visible pending inbox once its durable target is a room.
const boundDirectIds = new Set<string>()
let directOutboxRestoring: Promise<void> | undefined
let outboxRestoring: Promise<void> | undefined
let outboxDraining = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
const retryAttempts = new Map<string, number>()
const retryAfter = new Map<string, number>()
const reactionLocks = new Set<string>()
export const messageBackupWarning = ref(false)
export const olderAvailable = ref(false)
export const openingHistory = ref(false), openingHistoryError = ref(false)
export const incomingError = ref(false)
const joiningIncoming = new Set<string>(), failedIncoming = new Set<string>(), activatedConversations = new Set<string>()
const initialHistoryRooms = new Set<string>(), initialHistoryPending = new Set<string>(), initialHistoryFailures = new Set<string>()
export const security = ref({
    deviceSigned: false,
    identityVerified: false,
    canBackup: false,
    storage: false,
    verified: false,
    backup: false,
    remaining: undefined as number | undefined,
  }),
  recoveryText = ref(''),
  recoveryBusy = ref(false),
  recoveryError = ref<MessageText>(),
  restored = ref(false)
export const accountRecoveryReady = ref(false)
export const diagnostic = ref('idle'),
  restoredKeys = ref(0),
  peerVerified = ref(false)
export const verification = shallowRef<VerificationRequest>(),
  sas = shallowRef<ShowSasCallbacks>(),
  verificationPhase = ref(0)
let contactsPoll: ReturnType<typeof setInterval> | undefined
// Navigator offline events are immediate, while Matrix may only emit its
// network-error transition after a long sync poll. Do not mark online until
// Matrix itself establishes an authenticated sync.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    if (client) connection.value = 'offline'
  })
  window.addEventListener('online', () => {
    if (requested && account.value && !client) void startMessaging()
  })
}
let client: MatrixClient | undefined,
  sdk: typeof import('matrix-js-sdk'),
  cryptoModule: typeof import('matrix-js-sdk/lib/crypto-api'),
  release: (() => void) | undefined,
  startup: Promise<void> | undefined,
  generation = 0,
  requested = false,
  owner = '',
  secret: Uint8Array<ArrayBuffer> | undefined,
  generated: GeneratedSecretStorageKey | undefined
const silent = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  getChild: () => silent,
}
const active = () => rooms.value.find((room) => room.id === selected.value)
const resolvedPeers = new Map<string, Peer>(), resolvingPeers = new Set<string>(), unresolvedPeers = new Set<string>()
export const activeChat = computed(active)
export const directPeer = computed(() => activeChat.value?.direct ? activeChat.value.members.find(member => member.id !== client?.getUserId()) : undefined)
function name(id: string) {
  if (id === client?.getUserId()) return m('you')
  const peer = peers.value.find((value) => value.matrixUserId === id) || resolvedPeers.get(id)
  return (
    peer?.fields.name ||
    (peer?.username ? '@' + peer.username : peer?.fields.username) ||
    peer?.publicId ||
    ui('participant')
  )
}
function resolveNames() {
  const current = client, version = generation
  if (!current) return
  const ids = new Set(current.getRooms().flatMap(room => room.getMembers().map(member => member.userId)))
  for (const id of ids) {
    if (id === current.getUserId() || resolvedPeers.has(id) || resolvingPeers.has(id) || unresolvedPeers.has(id) || peers.value.some(peer => peer.matrixUserId === id)) continue
    resolvingPeers.add(id)
    void identityRequest<Peer>('/matrix/resolve/' + encodeURIComponent(id)).then(peer => {
      if (client === current && generation === version) { resolvedPeers.set(id, peer); refresh() }
    }).catch(() => { if (generation === version) unresolvedPeers.add(id) }).finally(() => { if (generation === version) resolvingPeers.delete(id) })
  }
}
function isAuxiliaryRelation(event: import('matrix-js-sdk').MatrixEvent) {
  const relation = event.getOriginalContent()['m.relates_to']?.rel_type
  return relation === sdk.RelationType.Replace || relation === sdk.RelationType.Annotation
}
function clearMarker(event: import('matrix-js-sdk').MatrixEvent) {
  return (
    event.isEncrypted() &&
    !event.isRedacted() &&
    event.getContent()['org.photobunker.control']?.version === 1 &&
    event.getContent()['org.photobunker.control']?.action ===
      'clear-conversation'
  )
}
function conversationDeleted(room: Room) {
  const events = room.getLiveTimeline().getEvents()
  const direct =
    room.currentState.getStateEvents('org.photobunker.chat', '')?.getContent()
      .kind === 'direct'
  let marker = -1
  if (direct && room.getMembers().length === 2)
    for (let i = 0; i < events.length; i++)
      if (
        clearMarker(events[i]!) &&
        room
          .getMembers()
          .some((member) => member.userId === events[i]!.getSender())
      )
        marker = i
  const fresh = (event: import('matrix-js-sdk').MatrixEvent) =>
    !event.isRedacted() &&
    !clearMarker(event) &&
    (event.isEncrypted() || event.getType() === 'm.room.message')
  if (marker >= 0 && !events.slice(marker + 1).some(fresh)) return true
  return (
    !!uiState(room).deleted &&
    !events.some(
      (event) => fresh(event) && event.getTs() > (uiState(room).clearedAt ?? 0),
    )
  )
}
function roomChat(room: Room): Chat {
  const members = room
    .getMembers()
    .filter((member) => ['join', 'invite'].includes(member.membership || ''))
    .map((member) => ({ id: member.userId, name: name(member.userId) }))
  const direct =
    room.currentState.getStateEvents('org.photobunker.chat', '')?.getContent()
      .kind === 'direct' || !!room.getDMInviter()
  const other = members.find((member) => member.id !== client?.getUserId())
  const last = [...room.getLiveTimeline().getEvents(), ...room.getPendingEvents()].filter(event =>
    !event.isRedacted() && !clearMarker(event) && event.getTs() > (uiState(room).clearedAt ?? 0) &&
    !uiState(room).hidden?.includes(event.getId() || '') && !blocked.has(event.getSender() || '') &&
    event.getContent().msgtype !== 'm.key.verification.request' && !isAuxiliaryRelation(event) &&
    (event.isEncrypted() || event.getType() === 'm.room.message'),
  ).at(-1)
  const preview = !last ? '' : last.isDecryptionFailure() || (!last.isEncrypted() && !last.status) ? m('locked')
    : String(last.getContent().body || '').replace(/^>.*(?:\n>.*)*\n\n/, '').replace(/\s+/g, ' ').trim()
  return {
    id: room.roomId,
    name: direct
      ? other?.name ||
        (room.getDMInviter() ? name(room.getDMInviter()!) : room.name)
      : room.name,
    membership: room.getMyMembership(),
    encrypted: !!room.currentState.getStateEvents('m.room.encryption', ''),
    direct,
    members,
    blocked: members.some((member) => blocked.has(member.id)),
    unread: room.getUnreadNotificationCount(),
    archived: !!uiState(room).archived,
    deleted: conversationDeleted(room),
    muted: (() => {
      try { return !!client?.getRoomPushRule('global', room.roomId)?.actions.some(action => action === 'dont_notify') }
      catch { return false }
    })(),
    preview,
    lastTime: last?.getTs() ?? 0,
    lastMine: last?.getSender() === client?.getUserId(),
  }
}
let blocked = new Set<string>()
export async function refreshPeers() {
  const version = generation
  const result = await identityRequest<{ peers: Peer[]; blocked: string[] }>(
    '/matrix/peers',
  )
  if (version !== generation) return
  peers.value = result.peers
  blocked = new Set(result.blocked)
  if (client) {
    if (
      JSON.stringify(client.getIgnoredUsers().sort()) !==
      JSON.stringify([...result.blocked].sort())
    )
      await client.setIgnoredUsers(result.blocked)
    if (version !== generation) return
    refresh()
  }
}
function refresh() {
  if (!client) return
  rooms.value = client
    .getRooms()
    .filter((room) => ['join', 'invite'].includes(room.getMyMembership()))
    .map(roomChat)
    .sort((a, b) => b.lastTime - a.lastTime || a.name.localeCompare(b.name))
  resolveNames()
  searchResults.value = searchResults.value.filter((hit) => {
    const room = client!.getRoom(hit.roomId),
      event = room?.findEventById(hit.id)
    return (
      !!room &&
      !!event &&
      !event.isRedacted() &&
      !conversationDeleted(room) &&
      event.getTs() > (uiState(room).clearedAt ?? 0) &&
      !uiState(room).hidden?.includes(hit.id)
    )
  })
  refreshMessages()
  void joinIncomingConversations()
}
async function retryTrustedMessages(current: MatrixClient) {
  if (client !== current || !security.value.verified) return
  for (const room of current.getRooms()) for (const event of room.getLiveTimeline().getEvents()) {
    try { await retrySignedEvent(current, event, () => requireClient(current)) }
    catch { /* Keep unsafe or unavailable events locked. */ }
  }
}
export async function joinIncomingConversations(retry = false) {
  const current = client
  if (!current || diagnostic.value !== 'ready') return
  if (retry) { failedIncoming.clear(); incomingError.value = false }
  for (const room of current.getRooms()) {
    const chat = roomChat(room)
    if (chat.membership !== 'invite' || chat.blocked || !chat.encrypted || joiningIncoming.has(room.roomId) || failedIncoming.has(room.roomId)) continue
    const inviter = room.getMember(current.getUserId()!)?.events.member?.getSender()
    if (!inviter) continue
    joiningIncoming.add(room.roomId)
    void (async () => {
      try {
        await identityRequest(`/matrix/resolve/${encodeURIComponent(inviter)}`)
        requireClient(current)
        await current.joinRoom(room.roomId)
        requireClient(current)
        refresh()
        void drainDurableOutbox(current)
      } catch {
        if (client === current) { failedIncoming.add(room.roomId); incomingError.value = true }
      } finally { if (client === current) joiningIncoming.delete(room.roomId) }
    })()
  }
}
async function activateConversation(current: MatrixClient, id: string) {
  const kind = current.getRoom(id)?.currentState.getStateEvents('org.photobunker.chat', '')?.getContent().kind
  if (!['direct', 'group'].includes(kind) || activatedConversations.has(id)) return
  await identityRequest('/matrix/conversations/activate', 'POST', { roomId: id })
  requireClient(current)
  const room = current.getRoom(id)
  if (!room || room.getMyMembership() !== 'join') throw new Error('room_not_ready')
  // The activation endpoint validates the encrypted room and joins invited
  // PhotoBunker accounts using their workspace sessions before it responds.
  // Do not wait for the sender's /sync loop to observe those remote membership
  // events: doing so kept an already-active conversation stuck on "Opening".
  activatedConversations.add(id)
  refresh()
}
/** Custom reaction event deliberately uses an encrypted Matrix event type.
 * matrix-js-sdk 44 explicitly skips encryption of standard m.reaction.
 * Plaintext emoji are unacceptable under PhotoBunker's E2EE contract.
 */
const privateReactionEventType = 'org.photobunker.reaction.v2'
/** Aggregate decrypted reactions, not arbitrary original wire content. */
function visibleReactionRecords(room: Room, id: string): ReactionRecord[] {
  // Matrix SDK aggregates decrypted relations asynchronously. Room.timeline
  // and MatrixEvent.Decrypted can fire before that collection is updated, so
  // include actual decrypted timeline events instead of relying on the derived
  // aggregation alone. Merge by event ID to prevent duplicate emoji counts.
  // Do not expose Matrix m.relates_to: it would put the emoji key in an
  // unencrypted event envelope. Resolve the private target from decrypted
  // event content instead, and aggregate only locally.
  const events = new Map<string, import('matrix-js-sdk').MatrixEvent>()
  for (const event of [...room.getLiveTimeline().getEvents(), ...room.getPendingEvents()]) {
    const id = event.getId()
    if (id && event.getType() === privateReactionEventType) events.set(id, event)
  }
  return [...events.values()].flatMap(event => {
    if (!event.getId() || event.isRedacted() || event.isDecryptionFailure() ||
        !event.isEncrypted() || event.status === 'not_sent' ||
        blocked.has(event.getSender() || '')) return []
    const relation = event.getContent()['org.photobunker.reaction']
    if (!relation || typeof relation !== 'object' || relation.event_id !== id ||
        typeof relation.key !== 'string' || !isReactionKey(relation.key)) return []
    return [{ key: relation.key, sender: event.getSender() || '', id: event.getId()!, timestamp: event.getTs() }]
  })
}
function canInteractWithEvent(current: MatrixClient, room: Room, id: string) {
  if (!current.getUserId() || !security.value.verified || roomChat(room).blocked || room.getMyMembership() !== 'join' ||
      !roomChat(room).encrypted || !id.startsWith('$')) return false
  const event = room.findEventById(id)
  return !!event && !!event.getId() && event.status == null &&
    event.isEncrypted() && !event.isRedacted() && !event.isDecryptionFailure() &&
    !blocked.has(event.getSender() || '') &&
    event.getType() === sdk.EventType.RoomMessage && !isAuxiliaryRelation(event)
}
export function canEditMessage(id: string) {
  const current = client, room = current?.getRoom(selected.value)
  if (!current || !room || !canInteractWithEvent(current, room, id)) return false
  const event = room.findEventById(id)!
  const content = event.getContent()
  return event.getSender() === current.getUserId() &&
    content.msgtype === sdk.MsgType.Text &&
    !content['org.photobunker.photo'] && !content.file
}
export async function editMessage(id: string, body: string) {
  const current = client, room = current?.getRoom(selected.value)
  if (!current || !room || !canEditMessage(id) || !body.trim() || body.length > 10000)
    throw new Error('permission')
  await refreshPeers()
  requireClient(current)
  if (!canEditMessage(id) || !(await current.getCrypto()!.isEncryptionEnabledInRoom(room.roomId)))
    throw new Error('unsafe_room')
  requireClient(current)
  const text = body.trim()
  const originalReply = room.findEventById(id)?.getContent()['m.relates_to']?.['m.in_reply_to']?.event_id
  const replacement = {
    msgtype: sdk.MsgType.Text as import('matrix-js-sdk').MsgType.Text,
    body: text,
    ...(typeof originalReply === 'string' && originalReply.startsWith('$')
      ? { 'm.relates_to': { 'm.in_reply_to': { event_id: originalReply } } } : {}),
  }
  await current.sendMessage(room.roomId, {
    msgtype: sdk.MsgType.Text,
    body: '* ' + text,
    'm.new_content': replacement,
    'm.relates_to': { rel_type: sdk.RelationType.Replace, event_id: id },
  })
  requireClient(current)
  refreshMessages()
  void preserveMessageKeys()
    .then(() => { if (client === current) messageBackupWarning.value = false })
    .catch(() => { if (client === current) messageBackupWarning.value = true })
}
export async function toggleReaction(id: string, key: ReactionKey) {
  if (!isReactionKey(key)) throw new Error('permission')
  const current = client, room = current?.getRoom(selected.value)
  if (!current || !room || !canInteractWithEvent(current, room, id)) throw new Error('permission')
  const lock = room.roomId + ':' + id + ':' + key
  if (reactionLocks.has(lock)) return
  reactionLocks.add(lock)
  try {
    await refreshPeers()
    requireClient(current)
    if (!canInteractWithEvent(current, room, id) ||
        !(await current.getCrypto()!.isEncryptionEnabledInRoom(room.roomId)))
      throw new Error('unsafe_room')
    requireClient(current)
    const own = visibleReactionRecords(room, id).find(row =>
      row.key === key && row.sender === current.getUserId())
    if (own) await current.redactEvent(room.roomId, own.id)
    else await current.sendEvent(room.roomId, privateReactionEventType, {
      'org.photobunker.reaction': { event_id: id, key },
    })
    requireClient(current)
    refreshMessages()
  } finally { reactionLocks.delete(lock) }
}

function refreshMessages() {
  initialHistoryFlags()
  const room = client?.getRoom(selected.value)
  if (!room) {
    messages.value = []
    olderAvailable.value = false
    return
  }
  olderAvailable.value = room.getLiveTimeline().getPaginationToken(sdk.Direction.Backward) != null
  pinnedIds.value =
    room.currentState
      .getStateEvents('m.room.pinned_events', '')
      ?.getContent()
      .pinned?.filter((id: string) => {
        const event = room.findEventById(id)
        return (
          !uiState(room).hidden?.includes(id) &&
          (!event ||
            (!event.isRedacted() &&
              event.getTs() > (uiState(room).clearedAt ?? 0)))
        )
      }) ?? []
  const events = [
    ...room.getLiveTimeline().getEvents(),
    ...room.getPendingEvents(),
  ]
  const identities = events.filter(event => event.getId()).map(event => ({
    id: event.getId()!,
    txnId: event.getTxnId(),
    status: event.status,
  }))
  // A real Matrix echo retires the local projection and its ciphertext
  // outbox row. Never use body equality for reconciliation.
  for (const item of optimisticText.values()) {
    if (identities.some(event =>
      (!event.status && event.txnId === item.txnId) ||
      (item.serverEventId && event.id === item.serverEventId))) {
      optimisticText.delete(item.id)
      clearRetry(item.id)
      void eraseDurableText(item.txnId).catch(() => { outboxError.value = true })
    }
  }
  const seen = new Set<string>()
  const matrixMessages = events
    .filter((event) => {
      const id = event.getId()
      if (!id || seen.has(id)) return false
      seen.add(id)
      return (
        !event.isRedacted() &&
        event.getTs() > (uiState(room).clearedAt ?? 0) &&
        !uiState(room).hidden?.includes(id) &&
        !blocked.has(event.getSender() || '') &&
        event.getContent().msgtype !== 'm.key.verification.request' &&
        !isAuxiliaryRelation(event) &&
        (event.getType() === 'm.room.message' || event.isEncrypted())
      )
    })
    .map((event) => {
      const content = event.getContent(),
        mine = event.getSender() === client!.getUserId(),
        isLocal = !!event.status,
        locked =
          event.isDecryptionFailure() || (!event.isEncrypted() && !isLocal)
      const status: Message['status'] =
        event.status === 'not_sent'
          ? 'notSent'
          : isLocal
            ? 'sending'
            : mine &&
                room
                  .getJoinedMembers()
                  .some(
                    (member) =>
                      member.userId !== client!.getUserId() &&
                      !!room.getReadReceiptForUserId(member.userId, true) &&
                      room.hasUserReadEvent(member.userId, event.getId()!),
                  )
              ? 'read'
              : 'sent'
      return {
        id: event.getId()!,
        sender: name(event.getSender() || ''),
        mine,
        body: locked
          ? m('locked')
          : content.msgtype === 'm.audio' ? voiceText(voiceContent(content) ? 'voice' : 'failed') : content.msgtype === 'm.text'
            ? String(content.body || '').replace(/^>.*(?:\n>.*)*\n\n/, '')
            : attachmentContent(content) ? String(content['org.photobunker.caption'] || '')
            : '',
        time: event.getTs(),
        status,
        photoId:
          typeof content['org.photobunker.photo']?.id === 'string' &&
          /^[a-f0-9-]{36}$/i.test(content['org.photobunker.photo'].id)
            ? content['org.photobunker.photo'].id
            : undefined,
        reply: content['m.relates_to']?.['m.in_reply_to']?.event_id,
        locked,
        decryptionFailure: event.decryptionFailureReason || undefined,
        voice: locked ? undefined : voiceContent(content),
        attachment: locked ? undefined : attachmentContent(content),
        edited: !locked && !!event.replacingEvent() && !event.replacingEvent()!.isDecryptionFailure(),
        reactions: locked ? [] : summarizeReactions(visibleReactionRecords(room, event.getId()!), client!.getUserId() || ''),
      }
    })
    .filter((event) => event.body || event.attachment)
  const queued = visiblePendingText([...optimisticText.values()], identities, room.roomId)
  messages.value = [...matrixMessages, ...queued.map(item => ({
    id: item.id,
    sender: m('you'),
    mine: true,
    body: item.body,
    time: item.time,
    status: item.status,
    reply: item.reply,
    photoId: item.photoId,
    locked: false,
  } as Message))].sort((a, b) => a.time - b.time)
  if (!messages.value.length && olderAvailable.value && room.getMyMembership() === 'join') void loadInitialHistory()
}
function initialHistoryFlags() {
  openingHistory.value = initialHistoryPending.has(selected.value)
  openingHistoryError.value = initialHistoryFailures.has(selected.value)
}
export async function loadInitialHistory(force = false) {
  const current = client, room = current?.getRoom(selected.value)
  initialHistoryFlags()
  if (!current || !room || room.getMyMembership() !== 'join' || room.getLiveTimeline().getPaginationToken(sdk.Direction.Backward) == null || initialHistoryPending.has(room.roomId) || (!force && initialHistoryRooms.has(room.roomId))) return
  const id = room.roomId
  initialHistoryRooms.add(id); initialHistoryPending.add(id); initialHistoryFailures.delete(id); initialHistoryFlags()
  try {
    await current.scrollback(room, 40)
    if (client === current) refresh()
  } catch {
    if (client === current) initialHistoryFailures.add(id)
  } finally {
    if (client === current) { initialHistoryPending.delete(id); initialHistoryFlags() }
  }
}
async function securityStatus() {
  const current = client
  if (!current) return
  const crypto = current.getCrypto()!
  const [storage, trust, backup, signing] = await Promise.all([
    current.secretStorage.getDefaultKeyId(),
    crypto.getDeviceVerificationStatus(
      current.getUserId()!,
      current.getDeviceId()!,
    ),
    crypto.getActiveSessionBackupVersion(),
    crypto.getCrossSigningStatus(),
  ])
  if (current === client) {
    security.value = {
      deviceSigned: trust?.signedByOwner === true,
      identityVerified: trust?.crossSigningVerified === true,
      canBackup: Object.values(signing.privateKeysCachedLocally).every(Boolean),
      storage: !!storage,
      verified: canUseMessagingDevice(trust),
      backup: !!backup,
      remaining: security.value.remaining,
    }
    void restoreDurableOutbox(current)
  }
}
/**
 * Rehydrate after Matrix crypto is initialized. Device verification controls
 * recovery of old history; it must not strand fresh outgoing operations.
 * No plaintext is read for another account, a locked device or a foreign tab.
 * A persisted txnId is never replaced with a new ID on retry.
 */
async function restoreDurableOutbox(current: MatrixClient): Promise<void> {
  if (current !== client || diagnostic.value !== 'ready' || !owner) return
  if (outboxRestoring) { await outboxRestoring; return }
  if (outboxRestoredScope === owner) {
    if (connection.value === 'ready') void drainDurableOutbox(current)
    return
  }
  const expectedOwner = owner
  outboxRestoring = (async () => {
    const saved = await readDurableText()
    requireClient(current)
    if (expectedOwner !== owner) return
    for (const row of saved) {
      if (typeof row.peerId === 'string') {
        if (!pendingDirectTexts.value.some(item => item.id === row.id))
          pendingDirectTexts.value.push(row)
        continue
      }
      if (optimisticText.has(row.id)) continue
      const room = current.getRoom(row.roomId)
      const received = room?.getLiveTimeline().getEvents().some(event =>
        event.getTxnId() === row.txnId && !event.status)
      if (received) {
        void eraseDurableText(row.txnId).catch(() => { outboxError.value = true })
        continue
      }
      optimisticText.set(row.id, { ...row, status: 'queued', inFlight: false })
    }
    outboxRestoredScope = expectedOwner
    outboxError.value = false
    refreshMessages()
  })()
  try { await outboxRestoring }
  catch { if (current === client) outboxError.value = true }
  finally { outboxRestoring = undefined }
  if (client === current && connection.value === 'ready')
    void drainDurableOutbox(current)
}
export async function restorePendingDirectOutbox(): Promise<void> {
  // A locally remembered device is not server authorization. Only decrypt
  // this device's encrypted outbox after its PIN gate has opened.
  const locallyAllowed = hasConfirmedIdentity() ||
    (offlineCaptureIdentity.value && ['offline', 'checking'].includes(sessionState.value))
  if (!locallyAllowed || !appLockReady.value || appLocked.value) return
  const scope = account.value?.id && deviceId.value ? `${account.value.id}:${deviceId.value}` : ''
  if (!scope) return
  if (visibleDirectScope !== scope) {
    pendingDirectTexts.value = []
    boundDirectIds.clear()
    visibleDirectScope = scope
    directOutboxRestoredScope = ''
  }
  if (directOutboxRestoredScope === scope) return
  if (directOutboxRestoring) {
    await directOutboxRestoring
    if (directOutboxRestoredScope !== scope) return restorePendingDirectOutbox()
    return
  }
  directOutboxRestoring = (async () => {
    const saved = await readDurableText()
    if (`${account.value?.id || ''}:${deviceId.value}` !== scope) return
    // Do not overwrite a freshly inserted optimistic local intent if it was
    // created while IndexedDB was being read in this restore pass.
    const items = new Map(pendingDirectTexts.value.map(item => [item.id, item]))
    for (const row of saved) {
      if (typeof row.peerId === 'string' && !boundDirectIds.has(row.id))
        items.set(row.id, { id: row.id, txnId: row.txnId,
          peerId: row.peerId, body: row.body, time: row.time })
    }
    pendingDirectTexts.value = [...items.values()].sort((a, b) => a.time - b.time)
    directOutboxRestoredScope = scope
    outboxError.value = false
  })()
  try { await directOutboxRestoring }
  catch { outboxError.value = true }
  finally { directOutboxRestoring = undefined }
}
export async function queueDirectText(peerId: string, body: string): Promise<string> {
  const locallyAllowed = hasConfirmedIdentity() ||
    (offlineCaptureIdentity.value && ['offline', 'checking'].includes(sessionState.value))
  if (!locallyAllowed || !appLockReady.value || appLocked.value) throw new Error('outbox.locked')
  const scope = `${account.value?.id || ''}:${deviceId.value}`
  if (visibleDirectScope && visibleDirectScope !== scope) throw new Error('outbox.cancelled')
  visibleDirectScope = scope
  const text = body.trim()
  if (!text || text.length > 10000) throw new Error('not_ready')
  const txnId = 'pb-' + crypto.randomUUID()
  const item: PendingDirectText = {
    id: '~pb-ui:' + txnId,
    txnId,
    peerId,
    body: text,
    time: Date.now(),
  }
  pendingDirectTexts.value.push(item)
  try {
    await saveDurableText(item)
    outboxError.value = false
    return item.id
  } catch (error) {
    pendingDirectTexts.value = pendingDirectTexts.value.filter(value => value.id !== item.id)
    outboxError.value = true
    throw error
  }
}
export async function bindDirectOutbox(peerId: string, roomId: string): Promise<void> {
  const current = client
  const room = current?.getRoom(roomId)
  if (!current || !room || !roomChat(room).encrypted || roomChat(room).blocked)
    throw new Error('not_ready')
  for (const item of pendingDirectTexts.value.filter(value => value.peerId === peerId)) {
    requireClient(current)
    await saveDurableText({
      id: item.id,
      txnId: item.txnId,
      roomId,
      body: item.body,
      time: item.time,
    })
    boundDirectIds.add(item.id)
    requireClient(current)
    optimisticText.set(item.id, {
      id: item.id,
      txnId: item.txnId,
      roomId,
      body: item.body,
      time: item.time,
      status: 'queued',
      inFlight: false,
    })
    pendingDirectTexts.value = pendingDirectTexts.value.filter(value => value.id !== item.id)
  }
  refreshMessages()
  if (client === current && connection.value === 'ready')
    void drainDurableOutbox(current)
}
function clearRetry(id: string) {
  retryAttempts.delete(id)
  retryAfter.delete(id)
}
function armRetryWake(current: MatrixClient) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
  if (client !== current || connection.value !== 'ready' ||
      !retryAfter.size) return
  // A single timer watches ALL outstanding attempts, not merely the last
  // failed send. After one retry, subsequent messages must not get stranded.
  const earliest = Math.min(...retryAfter.values())
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (client === current && connection.value === 'ready')
      void drainDurableOutbox(current)
  }, Math.max(0, earliest - Date.now()))
}
function scheduleTextRetry(current: MatrixClient, entry: PendingText) {
  if (client !== current) return
  const attempt = retryAttempts.get(entry.id) ?? 0
  retryAttempts.set(entry.id, attempt + 1)
  retryAfter.set(entry.id, Date.now() + retryDelayMs(attempt))
  armRetryWake(current)
}
async function drainDurableOutbox(current: MatrixClient) {
  if (!hasConfirmedIdentity() || appLocked.value ||
      outboxDraining || client !== current || connection.value !== 'ready' ||
      diagnostic.value !== 'ready' || outboxRestoredScope !== owner) return
  outboxDraining = true
  try {
    for (const item of optimisticText.values()) {
      if (client !== current || connection.value !== 'ready') return
      if (item.status !== 'queued' || item.inFlight ||
          (retryAfter.get(item.id) ?? 0) > Date.now()) continue
      retryAfter.delete(item.id)
      const room = current.getRoom(item.roomId)
      if (!room || room.getMyMembership() !== 'join' || !roomChat(room).encrypted ||
          roomChat(room).blocked) continue
      try { await dispatchText(item, current) }
      catch { /* A definitive failure becomes Not sent; the user retains Retry. */ }
    }
  } finally {
    outboxDraining = false
    armRetryWake(current)
  }
}

export function stopMessaging(clearRequest = true) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
  retryAttempts.clear()
  retryAfter.clear()
  optimisticText.clear()
  pendingDirectTexts.value = []
  outboxRestoredScope = ''
  directOutboxRestoredScope = ''
  visibleDirectScope = ''
  boundDirectIds.clear()
  directOutboxRestoring = undefined
  outboxRestoring = undefined
  outboxDraining = false
  outboxError.value = false
  reactionLocks.clear()
  messageBackupWarning.value = false
  joiningIncoming.clear(); failedIncoming.clear(); activatedConversations.clear(); incomingError.value = false
  initialHistoryRooms.clear(); initialHistoryPending.clear(); initialHistoryFailures.clear()
  openingHistory.value = false; openingHistoryError.value = false
  resolvedPeers.clear()
  resolvingPeers.clear()
  unresolvedPeers.clear()
  if (clearRequest) requested = false
  if (contactsPoll) clearInterval(contactsPoll)
  contactsPoll = undefined
  generation++
  conversationState.clear()
  pinnedIds.value = []
  searchResults.value = []
  searchBusy.value = false
  startup = undefined
  owner = ''
  const previous = client
  client = undefined
  bindCalls(undefined)
  previous?.stopClient()
  previous?.removeAllListeners()
  release?.()
  release = undefined
  secret?.fill(0)
  secret = undefined
  generated?.privateKey.fill(0)
  generated = undefined
  accountRecoveryReady.value = false
  recoveryText.value = ''
  recoveryError.value = undefined
  recoveryBusy.value = false
  restored.value = false
  restoredKeys.value = 0
  peerVerified.value = false
  verification.value = undefined
  sas.value = undefined
  rooms.value = []
  messages.value = []
  selected.value = ''
  pendingConversationUi.value = false
  peers.value = []
  blocked.clear()
  security.value = {
    deviceSigned: false,
    identityVerified: false,
    canBackup: false,
    storage: false,
    verified: false,
    backup: false,
    remaining: undefined,
  }
  connection.value = 'idle'
}
watch(
  () => `${account.value?.id || ''}:${deviceId.value}`,
  (value) => {
    if ((owner && value !== owner) || (visibleDirectScope && value !== visibleDirectScope))
      stopMessaging()
  },
)
// A temporary /me failure must not permanently strand an encrypted outbox.
// Retry Matrix bootstrap after R0-02 actually confirms the same session,
// not merely when the browser's navigator.onLine flips back to true.
watch(sessionState, state => {
  if (state === 'revoked' || state === 'signed-out') stopMessaging()
  else if (state === 'offline' && client) connection.value = 'offline'
  else if (state === 'authenticated' && requested && !appLocked.value) {
    if (!client && !startup) void startMessaging()
    else if (client) {
      const current = client
      // A prior /me outage can set the UI offline while Matrix's sync
      // transport stayed alive. Require its actual sync state before resuming.
      if (current.getSyncState() === sdk.SyncState.Syncing ||
          current.getSyncState() === sdk.SyncState.Prepared)
        connection.value = 'ready'
      if (connection.value === 'ready') void restoreDurableOutbox(current)
    }
  }
})
window.addEventListener('pagehide', () => stopMessaging())
export function startMessaging(): Promise<void> {
  requested = true
  if (appLocked.value) return Promise.resolve()
  if (startup) return startup
  if (client) return Promise.resolve()
  if (!navigator.locks) {
    connection.value = 'unsupported'
    return Promise.resolve()
  }
  const current = ++generation
  connection.value = 'connecting'
  failure.value = undefined
  startup = (async () => {
    await loadIdentity(true)
    if (current !== generation) return
    // R0-02's trusted local capture descriptor does not authenticate an API
    // or Matrix session. Queue locally; connect only after /me is confirmed.
    if (!hasConfirmedIdentity()) {
      connection.value = sessionState.value === 'offline' ? 'offline' : 'idle'
      startup = undefined
      return
    }
    const confirmedAccount = account.value
    if (!confirmedAccount) return
    owner = `${confirmedAccount.id}:${deviceId.value}`
    await restorePendingDirectOutbox()
    if (current !== generation) return
    let initialized!: () => void
    const ready = new Promise<void>((resolve) => {
      initialized = resolve
    })
    void navigator.locks
      .request(
        `photobunker-matrix:${owner}`,
        { ifAvailable: true },
        async (lock) => {
          if (current !== generation) {
            initialized()
            return
          }
          if (!lock) {
            if (current === generation) connection.value = 'otherTab'
            initialized()
            return
          }
          let done!: () => void
          const held = new Promise<void>((resolve) => {
            done = resolve
          })
          release = done
          let owned: MatrixClient | undefined,
            privacyTimer: ReturnType<typeof setInterval> | undefined
          try {
            diagnostic.value = 'session'
            const session = await connectMatrix()
            if (current !== generation) throw new Error('cancelled')
            diagnostic.value = 'sdk'
            ;[sdk, cryptoModule] = await Promise.all([
              import('matrix-js-sdk'),
              import('matrix-js-sdk/lib/crypto-api'),
            ])
            const { logger } = await import('matrix-js-sdk/lib/logger')
            Object.assign(logger, silent, { log: () => {} })
            if (current !== generation) throw new Error('cancelled')
            const created = sdk.createClient({
              baseUrl: location.origin,
              accessToken: session.accessToken,
              userId: session.userId,
              deviceId: session.deviceId,
              logger: silent,
              verificationMethods: ['m.sas.v1'],
              fetchFn: async (input, init) => {
                if (current !== generation)
                  throw new Error('messages.cancelled')
                const path = new URL(
                  typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url,
                  location.origin,
                ).pathname
                if (
                  /\/_matrix\/client\/(?:v3|r0)\/keys\/device_signing\/upload$/.test(
                    path,
                  )
                ) {
                  const { auth: _auth, ...keys } = JSON.parse(
                    String(init?.body || '{}'),
                  )
                  try {
                    // Persist SDK private signing material under the one account key
                    // before its public identity becomes visible on Matrix.
                    if (await accountKey()) {
                      const secrets = await created.getCrypto()!.exportSecretsBundle!()
                      if (client !== created) throw new Error('messages.cancelled')
                      await saveAccountSecrets({ matrixSecrets: secrets })
                    }
                    const result = await identityRequest(
                      '/matrix/signing',
                      'POST',
                      { keys },
                    )
                    return new Response(JSON.stringify(result), {
                      status: 200,
                      headers: { 'Content-Type': 'application/json' },
                    })
                  } catch {
                    return new Response(
                      JSON.stringify({
                        errcode: 'M_FORBIDDEN',
                        error: 'Signing authorization failed',
                      }),
                      {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                      },
                    )
                  }
                }
                const result = await fetch(input, {
                  ...init,
                  cache: 'no-store',
                })
                if (result.status === 401 && client === created)
                  queueMicrotask(() => {
                    stopMessaging(false)
                    failure.value = 'sessionEnded'
                    void loadIdentity(true).then(() => {
                      if (requested && account.value) void startMessaging()
                    })
                  })
                return result
              },
              cryptoCallbacks: {
                getSecretStorageKey: async ({ keys }) => {
                  if (!secret || client !== created) return null
                  const id =
                    (await created.secretStorage.getDefaultKeyId()) ||
                    Object.keys(keys)[0]
                  return client === created && secret && id && keys[id]
                    ? [id, secret]
                    : null
                },
                cacheSecretStorageKey: (_id, _info, key) => {
                  if (client === created) secret = new Uint8Array(key)
                },
              },
            })
            owned = created
            client = created
            contactsPoll = setInterval(() => {
              if (client === created && connection.value === 'ready')
                void refreshPeers().catch(() => {})
            }, 15000)
            diagnostic.value = 'storage'
            const cryptoId = `${owner}:${session.deviceId}`
            const key = await storageKey(cryptoId)
            diagnostic.value = 'crypto'
            try {
              await created.initRustCrypto({
                cryptoDatabasePrefix: `photobunker-matrix-${cryptoId}`,
                storageKey: key,
              })
              await markCryptoReady(cryptoId)
            } finally {
              key.fill(0)
            }
            if (current !== generation) throw new Error('cancelled')
            created
              .getCrypto()!
              .setDeviceIsolationMode(
                new cryptoModule.OnlySignedDevicesIsolationMode(),
              )
            const update = () => {
              if (client === created) refresh()
            }
            for (const event of [
              sdk.RoomEvent.Timeline,
              sdk.RoomEvent.LocalEchoUpdated,
              sdk.RoomEvent.Receipt,
              sdk.RoomEvent.MyMembership,
              sdk.RoomEvent.Name,
              sdk.RoomEvent.Redaction,
              sdk.RoomEvent.AccountData,
              sdk.RoomStateEvent.Events,
            ] as const)
              created.on(event, update)
            created.on(sdk.MatrixEventEvent.Decrypted, () => { update(); void retryTrustedMessages(created) })
            created.on(cryptoModule.CryptoEvent.DevicesUpdated, () => { void retryTrustedMessages(created) })
            created.on(sdk.RoomEvent.AccountData, (event, room) => {
              if (event.getType() === uiType) {
                conversationState.delete(room.roomId)
                update()
              }
            })
            created.on(sdk.ClientEvent.AccountData, (event) => {
              if (
                client === created &&
                event.getType() === 'm.ignored_user_list'
              ) {
                blocked = new Set(
                  Object.keys(event.getContent().ignored_users || {}),
                )
                refresh()
              }
            })
            created.on(
              cryptoModule.CryptoEvent.KeyBackupSessionsRemaining,
              (count) => {
                if (client === created) security.value.remaining = count
              },
            )
            created.on(
              cryptoModule.CryptoEvent.VerificationRequestReceived,
              (request) => {
                if (client === created) handleVerification(request)
              },
            )
            for (const event of [
              cryptoModule.CryptoEvent.KeysChanged,
              cryptoModule.CryptoEvent.UserTrustStatusChanged,
              cryptoModule.CryptoEvent.KeyBackupStatus,
            ])
              created.on(event, () => {
                if (client === created) { void securityStatus().catch(() => {}); void retryTrustedMessages(created) }
              })
            let syncReady!: () => void
            const synced = new Promise<void>((resolve) => {
              syncReady = resolve
            })
            created.on(sdk.ClientEvent.Sync, (state) => {
              if (client !== created) return
              if (
                state === sdk.SyncState.Prepared ||
                state === sdk.SyncState.Syncing
              ) {
                connection.value = typeof navigator !== 'undefined' && navigator.onLine === false
                  ? 'offline' : 'ready'
                refresh()
                void restoreDurableOutbox(created)
                syncReady()
              } else if (
                state === sdk.SyncState.Error ||
                state === sdk.SyncState.Reconnecting
              )
                connection.value = 'offline'
            })
            bindCalls(
              created,
              (id) =>
                security.value.verified &&
                rooms.value.some(
                  (room) =>
                    room.id === id &&
                    room.membership === 'join' &&
                    room.encrypted &&
                    !room.blocked,
                ),
            )
            diagnostic.value = 'sync'
            await created.startClient({
              pendingEventOrdering: sdk.PendingEventOrdering.Detached,
              initialSyncLimit: 50,
              pollTimeout: 20000,
              disablePresence: true,
              lazyLoadMembers: true,
            })
            await Promise.race([
              synced,
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('sync_timeout')), 30000),
              ),
            ])
            if (current !== generation) throw new Error('cancelled')
            diagnostic.value = 'peers'
            await refreshPeers()
            diagnostic.value = 'security'
            await initializeMessagingIdentity(created, () => requireClient(created))
            await ensureMessagingRecovery(created)
            await created.getCrypto()!.checkKeyBackupAndEnable()
            await securityStatus()
            diagnostic.value = 'ready'
            await retryTrustedMessages(created)
            refresh()
            void restoreDurableOutbox(created)
            privacyTimer = setInterval(() => {
              if (client === created && document.visibilityState === 'visible') {
                void refreshPeers().catch(() => {})
                void (async () => {
                  if (!security.value.verified)
                    await created.getCrypto()!.userHasCrossSigningKeys(undefined, true)
                  if (client === created) await securityStatus()
                })().catch(() => {})
              }
            }, 15000)
            initialized()
            await held
          } catch (error) {
            if (current === generation)
              diagnostic.value += `:${error instanceof Error && ['TypeError', 'Error', 'CompileError', 'DOMException', 'OperationError', 'NotSupportedError'].includes(error.name) ? error.name : 'failure'}`
            if (current === generation) {
              connection.value = 'error'
              failure.value =
                error instanceof Error &&
                error.message === 'messages.keys_missing'
                  ? 'keysUnavailable'
                  : 'failed'
            }
            initialized()
          } finally {
            clearInterval(privacyTimer)
            owned?.stopClient()
            owned?.removeAllListeners()
            if (client === owned) client = undefined
            if (current === generation) {
              release = undefined
              startup = undefined
            }
          }
        },
      )
      .catch(() => {
        if (current === generation) {
          connection.value = 'error'
          failure.value = 'failed'
        }
        initialized()
      })
    await ready
  })()
  return startup
}
export function openRoom(id: string) {
  selected.value = id
  if (client) void retryTrustedMessages(client)
  peerVerified.value = false
  refreshMessages()
  void markRead()
  const other = active()?.direct
    ? active()?.members.find((member) => member.id !== client?.getUserId())
    : undefined
  if (other && client) {
    const current = client
    void current
      .getCrypto()!
      .getUserVerificationStatus(other.id)
      .then((status) => {
        if (client === current && selected.value === id)
          peerVerified.value = status.isVerified()
      })
      .catch(() => {})
  }
}
export async function markRead() {
  if (document.visibilityState !== 'visible' || !client) return
  const room = client.getRoom(selected.value),
    event = room
      ?.getLiveTimeline()
      .getEvents()
      .filter(
        (event) =>
          event.getSender() !== client!.getUserId() &&
          event.getType() === 'm.room.message' &&
          !event.isDecryptionFailure(),
      )
      .at(-1)
  if (event) await client.sendReadReceipt(event).catch(() => {})
}
export async function createChat(ids: string[], title: string) {
  if (!client || diagnostic.value !== 'ready' || !hasConfirmedIdentity() ||
      appLocked.value) throw new Error('not_ready')
  const current = client
  const { peers: contacts } = await identityRequest<{ peers: Peer[] }>('/matrix/conversations/prepare', 'POST', { peers: ids })
  requireClient(current)
  if (!contacts.length || contacts.some((peer) => !peer?.ready))
    throw new Error('invalid_peers')
  for (const peer of contacts) if (peer) resolvedPeers.set(peer.matrixUserId, peer)
  const direct = ids.length === 1 && !title.trim()
  if (direct) {
    const existing = current
      .getRooms()
      .find(
        (room) =>
          ['join', 'invite'].includes(room.getMyMembership()) &&
          roomChat(room).direct &&
          roomChat(room).members.length === 2 &&
          room
            .getMembers()
            .some(
              (member) =>
                member.userId === contacts[0]!.matrixUserId &&
                ['join', 'invite'].includes(member.membership ?? ''),
            ),
      )
    if (existing) {
      if (roomChat(existing).blocked || !roomChat(existing).encrypted) throw new Error('unsafe_room')
      if (existing.getMyMembership() === 'invite') {
        await current.joinRoom(existing.roomId)
        requireClient(current)
        refresh()
      }
      await activateConversation(current, existing.roomId)
      openRoom(existing.roomId)
      // Archiving/deletion are presentation preferences. Failure to persist
      // them must never prevent an already valid room from opening or sending.
      void saveConversation(existing.roomId, {
        archived: false,
        deleted: false,
      }).catch(() => {})
      return existing.roomId
    }
  }
  const result = await current.createRoom({
    preset: sdk.Preset.PrivateChat,
    is_direct: direct,
    invite: contacts.map((peer) => peer!.matrixUserId),
    ...(title.trim() ? { name: title.trim().slice(0, 80) } : {}),
    power_level_content_override: {
      redact: direct ? 0 : 50,
      events: {
        'm.room.pinned_events': 0,
        'org.matrix.msc3401.call.member': 0,
      },
    },
    initial_state: [
      {
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      },
      {
        type: 'm.room.history_visibility',
        state_key: '',
        content: { history_visibility: direct ? 'invited' : 'joined' },
      },
      {
        type: 'org.photobunker.chat',
        state_key: '',
        content: { kind: direct ? 'direct' : 'group', version: 1 },
      },
    ],
  })
  if (client !== current) throw new Error('messages.cancelled')
  await new Promise<void>((resolve, reject) => {
    if (client?.getRoom(result.room_id)) resolve()
    else {
      const deadline = Date.now() + 10000
      const timer = setInterval(() => {
        if (client !== current || Date.now() >= deadline) {
          clearInterval(timer)
          reject(new Error(client !== current ? 'messages.cancelled' : 'room_not_ready'))
        } else if (current.getRoom(result.room_id)) {
          clearInterval(timer)
          resolve()
        }
      }, 100)
    }
  })
  if (client !== current) throw new Error('messages.cancelled')
  await activateConversation(current, result.room_id)
  refresh()
  openRoom(result.room_id)
  return result.room_id
}
export async function leaveChat() {
  const current = client,
    id = selected.value
  if (!current || !id) return
  await current.leave(id)
  requireClient(current)
  if (selected.value === id) selected.value = ''
  refresh()
}
/**
 * Synchronous user-intent boundary: show the pending message *before*
 * network preflight. Validation cannot be deferred to a UI component.
 */
function prepareText(body: string, reply?: string, photoId?: string) {
  const current = client
  const room = current?.getRoom(selected.value)
  // Network state never gates a locally known, verified encrypted room.
  // Persist first and let the outbox drain when Matrix becomes ready.
  if (!current || !room
    || !['join', 'invite'].includes(room.getMyMembership()) || !roomChat(room).encrypted
    || roomChat(room).blocked || !body.trim() || body.length > 10000)
    throw new Error('not_ready')
  const txnId = 'pb-' + crypto.randomUUID()
  const entry: PendingText = {
    id: '~pb-ui:' + txnId,
    txnId,
    roomId: room.roomId,
    body: body.trim(),
    reply,
    photoId,
    time: Date.now(),
    // A local intent is never "sending" before encryption/persistence.
    status: 'queued',
    inFlight: false,
  }
  optimisticText.set(entry.id, entry)
  refreshMessages()
  return { entry, current }
}

function isMessagingOffline() { return connection.value === 'offline' }
async function dispatchText(entry: PendingText, current: MatrixClient) {
  if (entry.inFlight || optimisticText.get(entry.id) !== entry) return
  if (!hasConfirmedIdentity() || appLocked.value || connection.value !== 'ready') {
    entry.status = 'queued'
    refreshMessages()
    return
  }
  entry.inFlight = true
  entry.status = 'sending'
  refreshMessages()
  try {
    requireClient(current)
    const room = current.getRoom(entry.roomId)
    if (!room || room.getMyMembership() !== 'join')
      throw new Error('not_ready')
    await refreshPeers()
    requireClient(current)
    await activateConversation(current, room.roomId)
    requireClient(current)
    if (room.getMyMembership() !== 'join'
      || roomChat(room).blocked || !(await current.getCrypto()!.isEncryptionEnabledInRoom(room.roomId)))
      throw new Error('unsafe_room')
    requireClient(current)
    const reference = entry.photoId
      ? await workspace.request<{ photoId: string; assignmentId: string; roomId: string }>(
          `/photos/${entry.photoId}/reference`, 'POST',
        ) : undefined
    requireClient(current)
    if (reference && reference.roomId !== room.roomId) throw new Error('unsafe_room')
    // Check again after network preflight. Block/revoke may race activation.
    if (roomChat(room).blocked || room.getMyMembership() !== 'join')
      throw new Error('unsafe_room')
    // Retry Matrix's existing local echo if it already owns this txnId.
    // Creating a second SDK echo for the same operation causes phantom
    // duplicate bubbles even though Matrix server HTTP PUT is idempotent.
    const existingEcho = room.getPendingEvents().find(event => event.getTxnId() === entry.txnId)
    if (existingEcho && existingEcho.status !== 'not_sent') {
      entry.status = 'queued'
      refreshMessages()
      return
    }
    const ack = existingEcho
      ? await current.resendEvent(existingEcho, room)
      : await current.sendMessage(room.roomId, {
          ...(reference ? { 'org.photobunker.photo': { id: reference.photoId, assignmentId: reference.assignmentId } } : {}),
          msgtype: sdk.MsgType.Text,
          body: entry.body,
          ...(entry.reply ? { 'm.relates_to': { 'm.in_reply_to': { event_id: entry.reply } } } : {}),
        }, entry.txnId)
    requireClient(current)
    // Matrix local echo and eventual sync use the very same transaction ID.
    entry.serverEventId = ack.event_id
    entry.status = 'sent'
    refreshMessages()
    // Idempotent on reconnect: commit ACK and remove ciphertext outbox row.
    clearRetry(entry.id)
    try { await eraseDurableText(entry.txnId) }
    catch { if (client === current) outboxError.value = true }
    // Key backup failure must never turn an ACKed message into "not sent",
    // but it remains an actionable recovery warning in the PhotoBunker UI.
    void preserveMessageKeys()
      .then(() => { if (client === current) messageBackupWarning.value = false })
      .catch(() => { if (client === current) messageBackupWarning.value = true })
  } catch (error) {
    if (client === current && optimisticText.get(entry.id) === entry) {
      // Transient network and 5xx/429 faults must be queued, not lost.
      const transient = isMessagingOffline() || isTransientMessageError(error)
      entry.status = transient ? 'queued' : 'notSent'
      if (transient && !isMessagingOffline()) scheduleTextRetry(current, entry)
      refreshMessages()
    }
    throw error
  } finally {
    entry.inFlight = false
  }
}

/** Optimistically insert before disk I/O; resolve only after AES-GCM
 * ciphertext has been committed to IndexedDB. Caller may then clear draft.
 * A failed disk write preserves the user's composer text.
 */
export async function queueTextMessage(body: string, reply?: string, photoId?: string): Promise<string> {
  const { entry, current } = prepareText(body, reply, photoId)
  try {
    const data: DurableText = { id: entry.id, txnId: entry.txnId, roomId: entry.roomId,
      body: entry.body, time: entry.time,
      ...(entry.reply ? { reply: entry.reply } : {}),
      ...(entry.photoId ? { photoId: entry.photoId } : {}) }
    await saveDurableText(data)
  } catch (error) {
    optimisticText.delete(entry.id)
    if (client === current) { outboxError.value = true; refreshMessages() }
    throw error
  }
  if (client === current && connection.value === 'ready' &&
      current.getRoom(entry.roomId)?.getMyMembership() === 'join') {
    void dispatchText(entry, current).catch(() => {
      // Error remains available as Not sent with same txnId and Retry.
    })
  } else {
    entry.status = 'queued'
    if (client === current) refreshMessages()
  }
  return entry.id
}

/** Promise-based sender used by non-composer callers. */
export async function send(body: string, reply?: string, photoId?: string) {
  const { entry, current } = prepareText(body, reply, photoId)
  try {
    await saveDurableText({ id: entry.id, txnId: entry.txnId, roomId: entry.roomId,
      body: entry.body, time: entry.time,
      ...(entry.reply ? { reply: entry.reply } : {}),
      ...(entry.photoId ? { photoId: entry.photoId } : {}) })
  } catch (error) {
    optimisticText.delete(entry.id)
    if (client === current) refreshMessages()
    throw error
  }
  if (connection.value !== 'ready' ||
      current.getRoom(entry.roomId)?.getMyMembership() !== 'join') {
    entry.status = 'queued'; refreshMessages(); return
  }
  await dispatchText(entry, current)
}
export async function sendVoice(draft: VoiceDraft, reply?: string) {
  const current = client, room = current?.getRoom(selected.value)
  if (!current || !room || !security.value.verified || draft.duration < 500 || draft.duration > maxVoiceDuration || !draft.blob.size || draft.blob.size > maxVoiceBytes) throw new Error('not_ready')
  await refreshPeers()
  await activateConversation(current, room.roomId)
  requireClient(current)
  if (roomChat(room).blocked || !(await current.getCrypto()!.isEncryptionEnabledInRoom(room.roomId))) throw new Error('unsafe_room')
  const encrypted = await encryptVoice(draft.blob)
  requireClient(current)
  const upload = await current.uploadContent(encrypted.blob, { name: 'voice.bin', type: 'application/octet-stream', includeFilename: false })
  requireClient(current)
  await refreshPeers()
  requireClient(current)
  if (roomChat(room).blocked || room.getMyMembership() !== 'join') throw new Error('unsafe_room')
  const content = {
    msgtype: 'm.audio' as import('matrix-js-sdk').MsgType.Audio, body: voiceText('voice'),
    file: { ...encrypted.file, url: upload.content_uri },
    info: { mimetype: draft.blob.type, size: draft.blob.size, duration: draft.duration },
    'org.matrix.msc3246.voice': {},
    'org.matrix.msc1767.audio': { duration: draft.duration, waveform: draft.waveform },
    ...(reply ? { 'm.relates_to': { 'm.in_reply_to': { event_id: reply } } } : {}),
  }
  await current.sendMessage(room.roomId, content)
  requireClient(current)
  refreshMessages()
  await preserveMessageKeys()
}
/**
 * Native Matrix E2EE attachments. No original-image upload: browser sanitizes
 * image pixels before encrypt/upload. Documents are encrypted byte-exact.
 * A failed preflight retains selected File in the host composer for retry.
 */
export async function sendAttachment(file: File, caption = '', reply?: string) {
  const current = client, room = current?.getRoom(selected.value)
  if (!current || !room || !security.value.verified || connection.value !== 'ready' ||
      !roomChat(room).encrypted || roomChat(room).blocked || room.getMyMembership() !== 'join' ||
      caption.length > 10000) throw new Error('not_ready')
  const prepared = await prepareAttachment(file)
  requireClient(current)
  await refreshPeers()
  requireClient(current)
  await activateConversation(current, room.roomId)
  requireClient(current)
  if (!security.value.verified || room.getMyMembership() !== 'join' || roomChat(room).blocked ||
      !(await current.getCrypto()!.isEncryptionEnabledInRoom(room.roomId)))
    throw new Error('unsafe_room')
  const encrypted = await encryptAttachment(prepared.blob)
  requireClient(current)
  const upload = await current.uploadContent(encrypted.blob, {
    name: 'encrypted.bin', type: 'application/octet-stream', includeFilename: false,
  })
  requireClient(current)
  await refreshPeers()
  requireClient(current)
  if (!security.value.verified || room.getMyMembership() !== 'join' || roomChat(room).blocked ||
      !(await current.getCrypto()!.isEncryptionEnabledInRoom(room.roomId))) throw new Error('unsafe_room')
  // Keep Matrix's discriminated RoomMessageEventContent type intact.
  const baseContent = {
    body: prepared.name,
    file: { ...encrypted.file, url: upload.content_uri },
    info: {
      mimetype: prepared.mimetype, size: prepared.blob.size,
      ...(prepared.width ? { w: prepared.width } : {}),
      ...(prepared.height ? { h: prepared.height } : {}),
    },
    ...(caption.trim() ? { 'org.photobunker.caption': caption.trim() } : {}),
    ...(reply ? { 'm.relates_to': { 'm.in_reply_to': { event_id: reply } } } : {}),
  }
  const content = prepared.kind === 'image'
    ? { ...baseContent, msgtype: sdk.MsgType.Image as import('matrix-js-sdk').MsgType.Image }
    : { ...baseContent, msgtype: sdk.MsgType.File as import('matrix-js-sdk').MsgType.File }
  await current.sendMessage(room.roomId, content)
  requireClient(current)
  refreshMessages()
  // Keep recovery-key failures distinct from actual Matrix send failures.
  void preserveMessageKeys()
    .then(() => { if (client === current) messageBackupWarning.value = false })
    .catch(() => { if (client === current) messageBackupWarning.value = true })
}

/** Fetch ciphertext only from our trusted Matrix origin with authorization.
 * Decrypted content exists in a short-lived Blob owned by viewer component.
 */
export async function loadAttachment(message: Message, signal: AbortSignal): Promise<Blob> {
  const current = client, roomId = selected.value, attachment = message.attachment
  if (!current || !attachment) throw new Error('attachment.unavailable')
  const allowed = () => {
    requireClient(current)
    const room = current.getRoom(roomId)
    if (signal.aborted || selected.value !== roomId || !security.value.verified || !room ||
        room.getMyMembership() !== 'join' || roomChat(room).blocked ||
        !messages.value.some(item => item.id === message.id && item.attachment))
      throw new Error('attachment.unavailable')
  }
  allowed()
  const match = /^mxc:\/\/([^/]+)\/([a-z0-9_-]+)$/i.exec(attachment.file.url)
  if (!match || match[1] !== current.getDomain()) throw new Error('attachment.unavailable')
  const response = await fetch(
    `/_matrix/client/v1/media/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
    { headers: { Authorization: `Bearer ${current.getAccessToken()}` }, cache: 'no-store', signal },
  )
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_ATTACHMENT_BYTES)
    throw new Error('attachment.unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > MAX_ATTACHMENT_BYTES) throw new Error('attachment.unavailable')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  allowed()
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; chunk.fill(0) }
  const blob = await decryptAttachment(bytes, attachment)
  allowed()
  return blob
}
export async function loadVoice(message: Message, signal: AbortSignal) {
  const current = client, roomId = selected.value, voice = message.voice
  const available = () => {
    requireClient(current!)
    const room = current!.getRoom(roomId)
    if (signal.aborted || selected.value !== roomId || !security.value.verified || !room || room.getMyMembership() !== 'join' || roomChat(room).blocked || !messages.value.some(value => value.id === message.id && value.voice)) throw new Error('voice.unavailable')
  }
  if (!current || !voice) throw new Error('voice.unavailable')
  available()
  const match = /^mxc:\/\/([^/]+)\/([a-z0-9_-]+)$/i.exec(voice.file.url)
  if (!match || match[1] !== current.getDomain()) throw new Error('voice.unavailable')
  const response = await fetch(`/_matrix/client/v1/media/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`, { headers: { Authorization: `Bearer ${current.getAccessToken()}` }, cache: 'no-store', signal })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxVoiceBytes) throw new Error('voice.unavailable')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > maxVoiceBytes) throw new Error('voice.invalid')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  available()
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; chunk.fill(0) }
  const blob = await decryptVoice(bytes, voice)
  available()
  return blob
}
export async function retryMessage(id: string) {
  const current = client
  const room = client?.getRoom(selected.value)
  const optimistic = optimisticText.get(id)
  // A failed preflight has no Matrix local echo yet. Reuse its original
  // transaction ID to ensure server-side idempotency if an ACK was lost.
  if (optimistic) {
    if (!current || !room || room.roomId !== optimistic.roomId
      || optimistic.inFlight || !['notSent', 'queued'].includes(optimistic.status)) return
    const sdkEcho = room.getPendingEvents().find(event => event.getTxnId() === optimistic.txnId)
    if (!sdkEcho) {
      if (connection.value === 'ready' && hasConfirmedIdentity() && !appLocked.value)
        await dispatchText(optimistic, current)
      return
    }
    if (sdkEcho.status !== 'not_sent') return
    id = sdkEcho.getId() || id
  }
  const event = room?.getPendingEvents().find((event) => event.getId() === id)
  if (!current || !room || !event) return
  await refreshPeers()
  if (client !== current) throw new Error('messages.cancelled')
  if (
    roomChat(room).blocked ||
    !security.value.verified ||
    !(await current!.getCrypto()!.isEncryptionEnabledInRoom(room.roomId))
  )
    throw new Error('unsafe_room')
  requireClient(current!)
  await current!.resendEvent(event, room)
  requireClient(current!)
  refreshMessages()
}
export async function olderMessages() {
  const room = client?.getRoom(selected.value)
  if (client && room) {
    await client.scrollback(room, 50)
    refreshMessages()
  }
}
export async function blockContact() {
  const current = client
  if (!current) return
  const chat = active()
  const other = chat?.direct
    ? chat.members.find((member) => member.id !== client?.getUserId())
    : undefined
  const peer = peers.value.find((peer) => peer.matrixUserId === other?.id)
  if (!peer) throw new Error('invalid_peer')
  await identityRequest(`/blocks/${peer.publicId}`, 'POST')
  requireClient(current)
  await refreshPeers()
  requireClient(current)
  try {
    if (chat) await current.leave(chat.id)
    requireClient(current)
    if (selected.value === chat?.id) selected.value = ''
    refresh()
  } catch {
    refresh()
  }
}
function requireClient(current: MatrixClient) {
  // A stale network operation must never commit after a person/device switch,
  // even before the reactive stopMessaging watcher has run.
  if (client !== current || owner !== `${account.value?.id}:${deviceId.value}`)
    throw new Error('messages.cancelled')
}
let savingMessageKeys: Promise<void> | undefined
export async function preserveMessageKeys() {
  if (savingMessageKeys) return savingMessageKeys
  const current = client, scope = `${account.value?.id}:${deviceId.value}`
  if (!current || scope !== owner || !accountRecoveryReady.value) return
  savingMessageKeys = (async () => {
    const crypto = current.getCrypto()!, keys = await crypto.exportRoomKeys()
    requireClient(current)
    const version = await crypto.getActiveSessionBackupVersion()
    let pending = keys
    if (version) {
      try {
        const backed = await current.http.authedRequest<{rooms?: Record<string, {sessions?: Record<string, unknown>}>}>(sdk.Method.Get, '/room_keys/keys', {version})
        requireClient(current)
        pending = keys.filter(key => !backed.rooms?.[key.room_id]?.sessions?.[key.session_id])
      } catch { /* Keep unacknowledged SDK keys in the root-encrypted recovery package. */ }
    }
    requireClient(current)
    try { await saveAccountSecrets({ roomKeys: pending }) }
    catch (error) { if (!(await roomKeysSavedLocally(pending))) throw error }
  })().finally(() => { savingMessageKeys = undefined })
  return savingMessageKeys
}
async function ensureMessagingRecovery(current: MatrixClient) {
  const root = await accountKey()
  requireClient(current)
  accountRecoveryReady.value = !!root
  if (!root) return
  const saved = await readAccountSecrets(), crypto = current.getCrypto()!
  requireClient(current)
  const trust = await crypto.getDeviceVerificationStatus(current.getUserId()!, current.getDeviceId()!)
  const wasVerified = canUseMessagingDevice(trust)
  if (!wasVerified && saved?.matrixSecrets) {
    if (!crypto.importSecretsBundle) throw new Error('recovery.unsupported')
    await crypto.importSecretsBundle(saved.matrixSecrets)
    requireClient(current)
    await crypto.crossSignDevice(current.getDeviceId()!)
    await crypto.userHasCrossSigningKeys(undefined, true)
    requireClient(current)
    await crypto.checkKeyBackupAndEnable()
    if (saved.matrixSecrets.backup) {
      // Old history is optional to fresh messaging. Never hold the synced
      // composer hostage to a slow/missing backup or invent replacement keys.
      void crypto.restoreKeyBackup()
        .then(result => { if (client === current) { restoredKeys.value = result.imported; refresh() } })
        .catch(() => { if (client === current) messageBackupWarning.value = true })
    }
  }
  if (saved?.roomKeys?.length) {
    void crypto.importRoomKeys(saved.roomKeys)
      .then(() => { if (client === current) refresh() })
      .catch(() => { if (client === current) messageBackupWarning.value = true })
  }
  await securityStatus()
  requireClient(current)
  if (!security.value.verified && saved?.messageKey) {
    await restoreHistory(saved.messageKey)
    if (recoveryError.value) throw new Error('recovery.restore_failed')
  }
  await securityStatus()
  if (!security.value.verified) return // Legacy identity: never reset its keys.
  // Backup maintenance can involve several server roundtrips. Keep it
  // asynchronous once the device's cryptographic identity is established.
  // History/recovery errors remain visible in Security and never authorize
  // plaintext transport or an untrusted device.
  void (async () => {
    if (!security.value.storage) {
      await prepareRecovery()
      await enableRecovery()
      if (recoveryError.value) throw new Error('recovery.setup_failed')
    } else {
      await crypto.checkKeyBackupAndEnable()
      requireClient(current)
      const secrets = await crypto.exportSecretsBundle!()
      requireClient(current)
      await saveAccountSecrets({ matrixSecrets: secrets })
    }
    requireClient(current)
    await securityStatus()
  })().catch(() => { if (client === current) messageBackupWarning.value = true })
  requireClient(current)
  for (const room of current.getRooms())
    for (const event of room.getLiveTimeline().getEvents())
      if (event.isEncrypted()) void current.decryptEventIfNeeded(event, { isRetry: true }).catch(() => {})
}
export async function prepareRecovery() {
  const current = client
  if (!current) return
  if (await current.secretStorage.getDefaultKeyId())
    throw new Error('already_setup')
  requireClient(current)
  const saved = await readAccountSecrets()
  const { decodeRecoveryKey } = await import('matrix-js-sdk/lib/crypto-api/recovery-key')
  const key = saved?.messageKey ? { privateKey: decodeRecoveryKey(saved.messageKey), encodedPrivateKey: saved.messageKey } : await current.getCrypto()!.createRecoveryKeyFromPassphrase()
  if (client !== current) {
    key.privateKey.fill(0)
    throw new Error('messages.cancelled')
  }
  if (await accountKey()) await saveAccountSecrets({ messageKey: key.encodedPrivateKey })
  requireClient(current)
  generated = key
  recoveryText.value = key.encodedPrivateKey || ''
  recoveryError.value = undefined
}
export async function enableRecovery() {
  const current = client,
    prepared = generated,
    version = generation
  if (!current || !prepared || recoveryBusy.value) return
  const temporary = new Uint8Array(prepared.privateKey)
  recoveryBusy.value = true
  recoveryError.value = undefined
  try {
    secret = temporary
    const crypto = current.getCrypto()!
    if (!(await initializeMessagingIdentity(current, () => requireClient(current))))
      throw new Error('device_verification_required')
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: (makeRequest) => makeRequest({}),
    })
    requireClient(current)
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => {
        requireClient(current)
        return prepared
      },
      setupNewKeyBackup: true,
    })
    requireClient(current)
    await crypto.checkKeyBackupAndEnable()
    await securityStatus()
    requireClient(current)
    if (!security.value.verified || !security.value.backup)
      throw new Error('not_ready')
    if (await accountKey()) await saveAccountSecrets({ messageKey: prepared.encodedPrivateKey, matrixSecrets: await crypto.exportSecretsBundle!() })
    requireClient(current)
    recoveryText.value = ''
    prepared.privateKey.fill(0)
    generated = undefined
  } catch {
    if (version === generation) recoveryError.value = 'failed'
  } finally {
    temporary.fill(0)
    if (version === generation) {
      secret?.fill(0)
      secret = undefined
      recoveryBusy.value = false
    }
  }
}
export async function restoreHistory(value: string) {
  const current = client,
    version = generation
  if (!current || recoveryBusy.value) return
  recoveryBusy.value = true
  recoveryError.value = undefined
  restored.value = false
  let invalid = false,
    temporary: Uint8Array<ArrayBuffer> | undefined
  try {
    const { decodeRecoveryKey } =
      await import('matrix-js-sdk/lib/crypto-api/recovery-key')
    requireClient(current)
    try {
      temporary = decodeRecoveryKey(value.trim())
    } catch {
      invalid = true
      throw new Error('invalid_key')
    }
    const key = await current.secretStorage.getKey()
    if (!key || !(await current.secretStorage.checkKey(temporary, key[1]))) {
      invalid = true
      throw new Error('invalid_key')
    }
    requireClient(current)
    secret = temporary
    const crypto = current.getCrypto()!
    await crypto.bootstrapCrossSigning({
      authUploadDeviceSigningKeys: (makeRequest) => makeRequest({}),
    })
    requireClient(current)
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
    await crypto.checkKeyBackupAndEnable()
    const result = await crypto.restoreKeyBackup()
    requireClient(current)
    if (await accountKey()) await saveAccountSecrets({ messageKey: value.trim(), matrixSecrets: await crypto.exportSecretsBundle!() })
    requireClient(current)
    restoredKeys.value = result.imported
    for (const room of current.getRooms())
      for (const event of room.getLiveTimeline().getEvents())
        if (event.isEncrypted())
          void current
            .decryptEventIfNeeded(event, { isRetry: true })
            .catch(() => {})
    await securityStatus()
    requireClient(current)
    refresh()
    restored.value = true
  } catch {
    if (version === generation)
      recoveryError.value = invalid ? 'badKey' : 'restoreFailed'
  } finally {
    temporary?.fill(0)
    if (version === generation) {
      secret?.fill(0)
      secret = undefined
      recoveryBusy.value = false
    }
  }
}

const handled = new WeakSet<Verifier>()
function handleVerifier(verifier: Verifier) {
  const version = generation
  if (handled.has(verifier)) return
  handled.add(verifier)
  verifier.on(cryptoModule.VerifierEvent.ShowSas, (value) => {
    if (version === generation) sas.value = value
  })
  void verifier
    .verify()
    .then(async () => {
      if (version !== generation) return
      verificationPhase.value = 6
      sas.value = undefined
      openRoom(selected.value)
      const current = client
      await current?.getCrypto()!.userHasCrossSigningKeys(undefined, true)
      if (version === generation) await securityStatus()
    })
    .catch(() => {
      if (version !== generation) return
      verificationPhase.value = 5
      sas.value = undefined
    })
}
function handleVerification(request: VerificationRequest) {
  const version = generation
  verification.value = request
  sas.value = undefined
  let starting = false
  const update = () => {
    if (version !== generation) return
    verificationPhase.value = request.phase
    if (request.verifier) handleVerifier(request.verifier)
    if (request.phase === 3 && request.initiatedByMe && !starting) {
      starting = true
      void request
        .startVerification('m.sas.v1')
        .then((verifier) => {
          if (version === generation) handleVerifier(verifier)
        })
        .catch(() => {
          if (version === generation) verificationPhase.value = 5
        })
    }
  }
  request.on(cryptoModule.VerificationRequestEvent.Change, update)
  update()
}
export async function verifyContact() {
  const current = client
  const chat = active()
  const other = chat?.direct
    ? chat.members.find((member) => member.id !== client?.getUserId())
    : undefined
  if (!current || !other) throw new Error('invalid_peer')
  const request = await current
    .getCrypto()!
    .requestVerificationDM(other.id, chat!.id)
  requireClient(current)
  handleVerification(request)
}
export async function verifyOwnDevice() {
  const current = client
  if (!current) throw new Error('not_ready')
  const request = await current.getCrypto()!.requestOwnUserVerification()
  requireClient(current)
  handleVerification(request)
}
export async function acceptVerification() {
  await verification.value?.accept()
}
export async function confirmVerification(matches: boolean) {
  const version = generation
  if (matches) await sas.value?.confirm()
  else sas.value?.mismatch()
  if (version === generation) sas.value = undefined
}
export async function cancelVerification() {
  const version = generation
  try {
    if (verification.value?.pending) await verification.value.cancel()
  } catch {
  } finally {
    if (version === generation) {
      verification.value = undefined
      sas.value = undefined
    }
  }
}

export async function openAssignmentDiscussion(id: string) {
  const current = client
  if (!current || !security.value.verified) throw new Error('not_ready')
  const result = await workspace.discussion(id)
  requireClient(current)
  if (!result.roomId || result.state !== 'ready')
    throw new Error('workspace.pending')
  let room = current.getRoom(result.roomId)
  if (!room || room.getMyMembership() !== 'join')
    room = await current.joinRoom(result.roomId)
  requireClient(current)
  let encrypted = false
  for (let attempt = 0; attempt < 100; attempt++) {
    requireClient(current)
    room = current.getRoom(result.roomId)
    const state = room?.currentState.getStateEvents('m.room.encryption', '')
    if (state && state.getContent().algorithm !== 'm.megolm.v1.aes-sha2')
      throw new Error('unsafe_room')
    if (
      state &&
      (await current.getCrypto()!.isEncryptionEnabledInRoom(result.roomId))
    ) {
      encrypted = true
      break
    }
    // Room state can arrive before the Rust crypto store has processed the join.
    // Wait for both authorities; never enable a plaintext composer during sync.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  if (!encrypted) throw new Error('workspace.pending')
  requireClient(current)
  refresh()
  openRoom(result.roomId)
}

// Matrix account data contains only UI flags, timestamps and event IDs, never text.
type ConversationState = {
  archived?: boolean
  clearedAt?: number
  hidden?: string[]
  deleted?: boolean
}
const conversationState = new Map<string, ConversationState>()
export const pinnedIds = ref<string[]>([]),
  searchResults = ref<
    { roomId: string; roomName: string; id: string; body: string }[]
  >([])
export const searchBusy = ref(false),
  historyBusy = ref(false)
const uiType = 'org.photobunker.conversation'
function uiState(room: Room): ConversationState {
  return (
    conversationState.get(room.roomId) ??
    room.getAccountData(uiType)?.getContent() ??
    {}
  )
}
async function saveConversation(id: string, patch: ConversationState) {
  const current = client
  if (!current) throw new Error('not_ready')
  const path = `/user/${encodeURIComponent(current.getUserId()!)}/rooms/${encodeURIComponent(id)}/account_data/${uiType}`
  let previous: ConversationState = {}
  try {
    previous = await current.http.authedRequest(sdk.Method.Get, path)
  } catch (error) {
    if ((error as { httpStatus?: number }).httpStatus !== 404) throw error
  }
  requireClient(current)
  const value = { ...previous, ...patch }
  await current.http.authedRequest(sdk.Method.Put, path, undefined, value)
  requireClient(current)
  conversationState.set(id, value)
  refresh()
}
/** Real Matrix global push mute. No misleading device-notification toggles. */
export async function setConversationMuted(id: string, muted: boolean) {
  const current = client, room = current?.getRoom(id)
  if (!current || !room || room.getMyMembership() !== 'join') throw new Error('not_ready')
  const result = current.setRoomMutePushRule('global', id, muted)
  if (result) await result
  requireClient(current)
  refresh()
}
export async function archiveConversation(id: string, archived = true) {
  await saveConversation(id, { archived })
  if (selected.value === id) openRoom('')
}
export async function deleteMessages(ids: string[], everyone = false) {
  const current = client,
    room = current?.getRoom(selected.value)
  if (!current || !room || !ids.length) throw new Error('not_ready')
  // Never call server redaction/conversation deletion with a synthetic UI id.
  // An unsent preflight item can be discarded locally. An SDK NOT_SENT event
  // must be cancelled through Matrix rather than merely hidden.
  const pendingUi = ids.map(id => optimisticText.get(id)).filter((entry): entry is PendingText => !!entry)
  const sdkPending = ids.map(id => room.getPendingEvents().find(event => event.getId() === id))
    .filter((event): event is NonNullable<typeof event> => !!event)
  if (pendingUi.length || sdkPending.length) {
    if (everyone || pendingUi.some(entry => entry.inFlight || entry.roomId !== room.roomId)
      || sdkPending.some(event => event.status !== 'not_sent')) throw new Error('permission')
    for (const event of sdkPending) {
      if (event.getTxnId()) for (const entry of optimisticText.values()) {
        if (entry.roomId === room.roomId && entry.txnId === event.getTxnId() && !entry.inFlight)
          optimisticText.delete(entry.id)
      }
      current.cancelPendingEvent(event)
    }
    for (const entry of pendingUi) optimisticText.delete(entry.id)
    ids = ids.filter(id => !pendingUi.some(entry => entry.id === id) && !sdkPending.some(event => event.getId() === id))
    refreshMessages()
    if (!ids.length) return
  }
  if (everyone) {
    const direct = roomChat(room).direct
    if (direct)
      await identityRequest('/matrix/conversations/deletion', 'POST', {
        roomId: room.roomId,
      })
    requireClient(current)
    for (const id of ids) {
      requireClient(current)
      const event = room.findEventById(id)
      if (
        !event ||
        (!direct &&
          event.getSender() !== current.getUserId() &&
          !room.currentState.maySendRedactionForEvent(
            event,
            current.getUserId()!,
          ))
      )
        throw new Error('permission')
      await current.redactEvent(room.roomId, id)
    }
  } else
    await saveConversation(room.roomId, {
      hidden: [...new Set([...(uiState(room).hidden ?? []), ...ids])],
    })
  refreshMessages()
}
async function loadHistory(room: Room, current: MatrixClient) {
  let previous: string | null | undefined
  while (
    room.getLiveTimeline().getPaginationToken(sdk.Direction.Backward) !== null
  ) {
    const token = room
      .getLiveTimeline()
      .getPaginationToken(sdk.Direction.Backward)
    if (token === previous) break
    previous = token
    requireClient(current)
    await current.scrollback(room, 100)
    requireClient(current)
  }
  for (const event of room.getLiveTimeline().getEvents()) {
    requireClient(current)
    if (event.isEncrypted() && !event.isRedacted())
      await current.decryptEventIfNeeded(event)
  }
}
export async function loadAllMessages() {
  const current = client,
    room = current?.getRoom(selected.value)
  if (!current || !room) return
  historyBusy.value = true
  try {
    await loadHistory(room, current)
    refreshMessages()
  } finally {
    historyBusy.value = false
  }
}
export async function deleteConversation(id: string, everyone = false) {
  const current = client,
    room = current?.getRoom(id)
  if (!current || !room) throw new Error('not_ready')
  historyBusy.value = true
  try {
    await loadHistory(room, current)
    if (everyone) {
      if (!roomChat(room).direct) throw new Error('permission')
      await identityRequest('/matrix/conversations/deletion', 'POST', {
        roomId: id,
      })
      requireClient(current)
      for (const event of room.getLiveTimeline().getEvents()) {
        requireClient(current)
        if (
          !event.isRedacted() &&
          (event.getType() === 'm.room.message' || event.isEncrypted())
        )
          await current.redactEvent(id, event.getId()!)
      }
      if (!(await current.getCrypto()!.isEncryptionEnabledInRoom(id)))
        throw new Error('unsafe_room')
      requireClient(current)
      await current.sendMessage(id, {
        msgtype: sdk.MsgType.Notice,
        body: '',
        ...{
          'org.photobunker.control': {
            version: 1,
            action: 'clear-conversation',
          },
        },
      })
    }
    const timestamp = Math.max(
      0,
      ...room
        .getLiveTimeline()
        .getEvents()
        .map((e) => e.getTs()),
    )
    await saveConversation(id, {
      clearedAt: timestamp,
      deleted: true,
      archived: false,
      hidden: [],
    })
    if (selected.value === id) openRoom('')
  } finally {
    historyBusy.value = false
  }
}
export function canPinMessage() {
  const room = client?.getRoom(selected.value)
  return (
    !!room &&
    room.currentState.maySendStateEvent(
      'm.room.pinned_events',
      client!.getUserId()!,
    )
  )
}
export function canDeleteForEveryone(ids: string[]) {
  const current = client, room = current?.getRoom(selected.value)
  if (!current || !room || !ids.length) return false
  // Synthetic and unacknowledged SDK echoes are never redactable events.
  if (ids.some(id => optimisticText.has(id) || room.getPendingEvents().some(event => event.getId() === id))) return false
  if (roomChat(room).direct) return true
  return ids.every(id => {
    const event = room.findEventById(id)
    return !!event && (event.getSender() === current.getUserId() || room.currentState.maySendRedactionForEvent(event, current.getUserId()!))
  })
}
export async function pinMessage(id: string, pinned = true) {
  const current = client,
    room = current?.getRoom(selected.value)
  if (!current || !room || !canPinMessage()) throw new Error('permission')
  const old =
    room.currentState.getStateEvents('m.room.pinned_events', '')?.getContent()
      .pinned ?? []
  await current.sendStateEvent(
    room.roomId,
    sdk.EventType.RoomPinnedEvents,
    {
      pinned: pinned
        ? [...new Set([...old, id])]
        : old.filter((v: string) => v !== id),
    },
    '',
  )
  requireClient(current)
  refreshMessages()
}
let searchGeneration = 0
export function cancelMessageSearch() { searchGeneration++; searchResults.value = []; searchBusy.value = false }
export async function searchMessages(query: string) {
  const searchVersion = ++searchGeneration
  const current = client,
    version = generation
  if (!current || !query.trim()) return
  searchBusy.value = true
  searchResults.value = []
  try {
    for (const room of current
      .getRooms()
      .filter((r) => r.getMyMembership() === 'join' && !conversationDeleted(r))) {
      await loadHistory(room, current)
      if (version !== generation || searchVersion !== searchGeneration) return
      const state = uiState(room)
      for (const event of room.getLiveTimeline().getEvents()) {
        if (
          event.isRedacted() ||
          event.isDecryptionFailure() ||
          !event.isEncrypted() ||
          event.getTs() <= (state.clearedAt ?? 0) ||
          state.hidden?.includes(event.getId()!) ||
          blocked.has(event.getSender() ?? '') || isAuxiliaryRelation(event)
        )
          continue
        const body = event.getContent().body
        if (
          typeof body === 'string' &&
          body.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        )
          searchResults.value.push({
            roomId: room.roomId,
            roomName: roomChat(room).name,
            id: event.getId()!,
            body,
          })
      }
    }
  } finally {
    if (version === generation && searchVersion === searchGeneration) searchBusy.value = false
  }
}

/** D4: live Matrix/Rust confirmation, not the visible security card counter alone.
 * Any unknown or unbacked-up state must block local deletion.
 */
export async function assertMatrixRecoveryForLocalDelete(ownerId: string, localDeviceId: string) {
  const expected = ownerId + ':' + localDeviceId
  const current = client, sequence = generation
  if (!current || owner !== expected || connection.value !== 'ready' ||
    outboxDraining || outboxError.value || messageBackupWarning.value ||
    pendingDirectTexts.value.length || optimisticText.size ||
    joiningIncoming.size || initialHistoryPending.size ||
    recoveryBusy.value) throw new Error('localDelete.unsynced')
  const crypto = current.getCrypto()
  if (!crypto) throw new Error('localDelete.recovery')
  const [storage, backup, deviceTrust, remaining] = await Promise.all([
    current.secretStorage.getDefaultKeyId(),
    crypto.getActiveSessionBackupVersion(),
    crypto.getDeviceVerificationStatus(current.getUserId()!, current.getDeviceId()!),
    crypto.getKeyBackupInfo(),
  ])
  // A configured backup is not proof that every available key is backed up.
  // The existing UI's remaining count is advisory and may be stale.
  if (!storage || !backup || !deviceTrust?.signedByOwner ||
    !security.value.verified || security.value.remaining !== 0 ||
    !remaining || current.getRooms().some(room => room.getPendingEvents().length))
    throw new Error('localDelete.recovery')
  if (current !== client || sequence !== generation || owner !== expected ||
    connection.value !== 'ready') throw new Error('localDelete.scope')
}
