<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter, useRoute, RouterView } from 'vue-router'
import VoiceRecorder from '../components/VoiceRecorder.vue'
import MessageComposer from '../messages/shared-ui/MessageComposer.vue'
import EmojiStickerPicker from '../messages/shared-ui/EmojiStickerPicker.vue'
import { makeLocalSticker } from '../messages/picker'
import { privateFolders, clearPrivateFolders, loadPrivateFolders, createPrivateFolder, renamePrivateFolder, deletePrivateFolder, toggleRoomFolder } from '../messages/private-folders'
import { appLocked } from '../app/lock'
import VoiceMessagePlayer from '../components/VoiceMessagePlayer.vue'
import EncryptedAttachmentView from '../messages/shared-ui/EncryptedAttachmentView.vue'
import { validateAttachment } from '../messages/attachment'
import { reactionKeys, isReactionKey, type ReactionKey } from '../messages/reactions'
import ConversationListItem from '../messages/shared-ui/ConversationListItem.vue'
import MessageBubble from '../messages/shared-ui/MessageBubble.vue'
import MessageList from '../messages/shared-ui/MessageList.vue'
import ScrollToBottomButton from '../messages/shared-ui/ScrollToBottomButton.vue'
import MessageActionList from '../messages/shared-ui/MessageActionList.vue'
import ConversationSearch from '../messages/shared-ui/ConversationSearch.vue'
import SidebarHeader from '../messages/shared-ui/SidebarHeader.vue'
import ThreadHeader from '../messages/shared-ui/ThreadHeader.vue'
import MessengerSplitLayout from '../messages/shared-ui/MessengerSplitLayout.vue'
import { voiceText } from '../messages/voice-text'
import type { VoiceDraft } from '../messages/voice'
import CallPanel from '../components/CallPanel.vue'
import ContactsView from './ContactsView.vue'
import {
  phase as callPhase,
  enabled as callsEnabled,
  joinCall,
} from '../calls/store'
import { t as callText } from '../calls/text'
import AppIcon from '../components/AppIcon.vue'
import AppSheet from '../components/AppSheet.vue'
import { account, deviceId as identityDeviceId, hasConfirmedIdentity, sessionState, offlineCaptureIdentity } from '../identity/store'
import { IdentityError } from '../identity/api'
import { a } from '../identity/text'
import { u } from '../app/text'
import { s } from '../studio/text'
import { guardReload } from '../studio/unsaved'
import { w } from '../workspace/text'
import { m } from '../messages/text'
import { ui, initials, avatarColor, dayLabel, chatTime, membersCount } from '../messages/presentation'
import { formatDate, formatNumber } from '../i18n'
import { usePersonLookup } from '../messages/lookup'
import { decideChatEntry, canAutoOpenChat } from '../messages/chat-entry'
import { personText } from '../identity/person-text'
import { usePeerPresence } from '../profiles/presence'
import { presenceLabel } from '../profiles/presence-text'
import type { Message } from '../messages/store'
import {
  accountRecoveryReady,
  messageBackupWarning,
  outboxError,
  preserveMessageKeys,
  archiveConversation,
  setConversationMuted,
  deleteConversation,
  deleteMessages,
  canDeleteForEveryone,
  loadAllMessages,
  pinMessage,
  canPinMessage,
  canEditMessage,
  editMessage,
  toggleReaction,
  pinnedIds,
  searchMessages,
  cancelMessageSearch,
  searchResults,
  searchBusy,
  historyBusy,
  openingHistory,
  openingHistoryError,
  loadInitialHistory,
  openAssignmentDiscussion,
  peerVerified,
  restoredKeys,
  refreshPeers,
  diagnostic,
  connection,
  failure,
  rooms,
  peers,
  selected,
  messages,
  security,
  recoveryBusy,
  recoveryError,
  restored,
  verification,
  sas,
  verificationPhase,
  activeChat,
  directPeer,
  startMessaging,
  stopMessaging,
  openRoom,
  createChat,
  sendVoice,
  loadVoice,
  sendAttachment,
  loadAttachment,
  joinIncomingConversations,
  incomingError,
  queueTextMessage,
  pendingDirectTexts,
  pendingConversationUi,
  restorePendingDirectOutbox,
  queueDirectText,
  bindDirectOutbox,
  retryMessage,
  olderMessages,
  olderAvailable,
  leaveChat,
  blockContact,
  restoreHistory,
  verifyContact,
  verifyOwnDevice,
  acceptVerification,
  confirmVerification,
  cancelVerification,
  markRead,
} from '../messages/store'
const router = useRouter(),
  route = useRoute()
const profileOpen = computed(() => route.name === 'conversation-profile')
function openPerson(handle: string) {
  if (voiceDirty.value && !confirm(voiceText('discard'))) return
  newOpen.value = false; detailsOpen.value = false
  void router.push(`/messages/profile/${encodeURIComponent(handle)}`)
}
function profileMessage(handle: string, call = false) {
  void router.replace({ path: '/messages', query: { peer: handle, ...(call ? { call: 'audio' } : {}) } })
}
const linkedErrorCode = ref('')
const linkedError = ref(''),
  linkedPhoto = ref('')
let linkedAttempt = ''
async function enterDiscussion() {
  const id = String(route.query.assignment || '')
  if (
    !/^[a-f0-9-]{36}$/i.test(id) ||
    !security.value.verified ||
    connection.value !== 'ready'
  )
    return
  const key = `${account.value?.id}:${identityDeviceId.value}:${id}`
  if (linkedAttempt === key) return
  linkedAttempt = key
  linkedError.value = ''
  linkedErrorCode.value = ''
  try {
    await openAssignmentDiscussion(id)
    if (
      key !==
      `${account.value?.id}:${identityDeviceId.value}:${String(route.query.assignment || '')}`
    )
      return
    const photo = String(route.query.photo || '')
    if (/^[a-f0-9-]{36}$/i.test(photo)) {
      linkedPhoto.value = photo
      draft.value = `${w('photoReference')}: ${photo}`
    }
  } catch (error) {
    linkedErrorCode.value =
      error instanceof Error &&
      ['not_ready', 'unsafe_room', 'workspace.pending', 'cancelled'].includes(
        error.message,
      )
        ? error.message
        : 'request_failed'
    linkedError.value =
      linkedErrorCode.value === 'unsafe_room'
        ? m('unencrypted')
        : w('discussionPending')
    linkedAttempt = ''
  }
}
watch(
  [() => route.query.assignment, () => security.value.verified, connection],
  () => {
    if (!security.value.verified) linkedAttempt = ''
    else void enterDiscussion()
  },
)
const tab = ref('chats'),
  newOpen = ref(false),
  securityOpen = ref(false),
  detailsOpen = ref(false),
  draft = ref(''),
  reply = ref(''),
  chatName = ref(''),
  chosen = ref<string[]>([]),
  group = ref(false),
  actionBusy = ref(false),
  actionError = ref(''),
  restoreInput = ref(''),
  hidden = ref(document.hidden),
  log = ref<HTMLElement>()
const composer = ref<InstanceType<typeof MessageComposer>>()
const pickerOpen = ref(false)
const foldersOpen = ref(false)
const folderName = ref('')
const renameFolderId = ref('')
const renameFolderText = ref('')
const folderBusy = ref(false)
const folderError = ref('')
async function runFolderUpdate(action: () => Promise<void>) {
  if (folderBusy.value) return
  folderBusy.value = true; folderError.value = ''
  try { await action() }
  catch { folderError.value = ui('folderError') }
  finally { folderBusy.value = false }
}
function createFolder() {
  void runFolderUpdate(async () => {
    await createPrivateFolder(folderName.value)
    folderName.value = ''
  })
}
function saveFolderName() {
  const id = renameFolderId.value
  void runFolderUpdate(async () => {
    await renamePrivateFolder(id, renameFolderText.value)
    renameFolderId.value = ''
    renameFolderText.value = ''
  })
}
function removeFolder(id: string) {
  void runFolderUpdate(async () => {
    await deletePrivateFolder(id)
    if (tab.value === 'folder:' + id) tab.value = 'chats'
  })
}
function assignFolder(id: string, roomId: string) {
  if (!rooms.value.some(room => room.id === roomId && room.membership === 'join')) return
  void runFolderUpdate(() => toggleRoomFolder(id, roomId))
}
async function prepareSticker(symbol: string) {
  if (!security.value.verified || connection.value !== 'ready' || editingMessage.value ||
      !selected.value || appLocked.value) return
  const roomId = selected.value, userId = account.value?.id, version = actionGeneration
  pickerOpen.value = false
  try {
    const file = await makeLocalSticker(symbol)
    // Never attach a private media draft to another conversation/account
    // if the user navigated away during asynchronous image encoding.
    if (selected.value === roomId && account.value?.id === userId &&
        version === actionGeneration && !appLocked.value && security.value.verified)
      acceptAttachment(file)
  } catch {
    if (selected.value === roomId && account.value?.id === userId)
      attachmentError.value = ui('stickerFailed')
  }
}
const editingMessage = ref<{ id: string; roomId: string; original: string }>()
let editSnapshot: { text: string; reply: string } | undefined
function cancelEdit() {
  if (!editingMessage.value) return
  editingMessage.value = undefined
  if (editSnapshot) {
    draft.value = editSnapshot.text
    reply.value = editSnapshot.reply
  }
  editSnapshot = undefined
}
const attachmentInput = ref<HTMLInputElement>()
const chosenAttachment = ref<File>()
const attachmentPreviewUrl = ref('')
const attachmentBusy = ref(false)
const attachmentError = ref('')
function clearAttachment() {
  chosenAttachment.value = undefined
  if (attachmentPreviewUrl.value) URL.revokeObjectURL(attachmentPreviewUrl.value)
  attachmentPreviewUrl.value = ''
  attachmentError.value = ''
  if (attachmentInput.value) attachmentInput.value.value = ''
}
function acceptAttachment(file: File) {
  try {
    validateAttachment(file)
    clearAttachment()
    chosenAttachment.value = file
    if (file.type.startsWith('image/')) attachmentPreviewUrl.value = URL.createObjectURL(file)
  } catch {
    clearAttachment()
    attachmentError.value = ui('attachmentInvalid')
  }
}
function chooseAttachment(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) acceptAttachment(file)
}
const directHandle = ref(''), pendingPeer = ref(''), pendingCall = ref(false)
let actionGeneration = 0
const { person: foundPerson, busy: lookupBusy, error: lookupError, find: findPerson } = usePersonLookup(
  directHandle,
  computed(() => newOpen.value && !group.value && !hidden.value),
  computed(() => `${account.value?.id || ''}:${identityDeviceId.value}`),
)
const chatDrafts = new Map<string, { text: string; reply: string }>()
function chatEntryError(reason: 'offline' | 'otherTab' | 'unsupported' | 'error') {
  return m(reason === 'error' ? failure.value || 'failed' : reason)
}
function readyToWrite(handle?: string) {
  const decision = decideChatEntry(connection.value, diagnostic.value, security.value.verified)
  if (decision.kind === 'ready') return true
  if (handle) {
    pendingPeer.value = handle
    newOpen.value = false
  }
  if (decision.kind === 'recover') {
    // A group draft has no direct peer to resume: keep its selected people
    // and title rather than destroying the draft during device recovery.
    securityOpen.value = true
    actionError.value = ''
  } else {
    actionError.value = decision.kind === 'unavailable' ? chatEntryError(decision.reason) : m('connecting')
  }
  return false
}
async function writeDirect(handle: string, call = false) {
  if (actionBusy.value) return
  const peer = handle.trim()
  if (!peer) return
  // Opening a conversation is a local UI action. Keep the intent visible
  // immediately instead of waiting for Matrix startup/network recovery.
  pendingPeer.value = peer
  pendingCall.value = call
  // Move to the local DM surface before any Matrix room or network request.
  // The existing selected room must not mask the optimistic conversation.
  openRoom('')
  newOpen.value = false
  tab.value = 'chats'
  await perform(async () => {
    const version = actionGeneration
    // A stalled Identity/Matrix request must not own the pending chat
    // indefinitely. The bootstrap can finish in background; Retry and local
    // encrypted text entry remain available even after this UI deadline.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        startMessaging(),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 12000) }),
      ])
    } finally { clearTimeout(timeout) }
    if (version !== actionGeneration) return
    if (!readyToWrite(peer)) return
    const roomId = await createChat([peer], '')
    if (version !== actionGeneration) return
    pendingPeer.value = ''
    await bindDirectOutbox(peer, roomId)
    openRoom(roomId)
    directHandle.value = ''
    newOpen.value = false
    tab.value = 'chats'
    if (route.query.peer) void router.replace({ query: { ...route.query, peer: undefined, call: undefined } })
    if (call) await joinCall(roomId)
  })
}
// Deep-linked Write is an intent that must *never* disappear in recovery
// or offline states. Limit automatic room creation to once per intent; Retry
// remains explicit. The recipient id is used only for local control flow.
let autoOpenIntent = ''
watch(
  [() => route.query.peer, () => route.query.call, () => account.value?.id,
    () => security.value.verified, connection, diagnostic, actionBusy],
  () => {
    const peer = typeof route.query.peer === 'string' ? route.query.peer.trim() : ''
    if (!peer) { autoOpenIntent = ''; return }
    const call = route.query.call === 'audio'
    const decision = decideChatEntry(connection.value, diagnostic.value, security.value.verified)
    if (decision.kind === 'recover') {
      pendingPeer.value = peer
      pendingCall.value = call
      if (!securityOpen.value) {
        newOpen.value = false
        securityOpen.value = true
      }
      return
    }
    if (decision.kind === 'unavailable') {
      actionError.value = chatEntryError(decision.reason)
      return
    }
    if (decision.kind !== 'ready') return
    const intent = `${account.value?.id || ''}:${peer}:${call}`
    if (!canAutoOpenChat(decision, actionBusy.value, autoOpenIntent === intent)) return
    autoOpenIntent = intent
    pendingPeer.value = ''
    securityOpen.value = false
    void writeDirect(peer, call)
  },
  { immediate: true },
)
const listQuery = ref(''),
  messageQuery = ref(''),
  contactQuery = ref(''),
  selecting = ref(false),
  selectedMessages = ref<string[]>([]),
  swiped = ref(''),
  deleteTarget = ref(''),
  deleteForAll = ref(false)
let swipeX = 0,
  swipeY = 0
function endSwipe(event: TouchEvent, id: string) {
  const touch = event.changedTouches[0]
  if (
    touch &&
    swipeX - touch.clientX > 45 &&
    Math.abs(touch.clientY - swipeY) < 40
  ) {
    event.preventDefault()
    swiped.value = id
  } else if (touch && touch.clientX - swipeX > 45) {
    event.preventDefault()
    swiped.value = ''
  }
}
function askDelete(id: string) {
  deleteTarget.value = id
  deleteForAll.value = false
}
async function confirmDelete() {
  await perform(async () => {
    await deleteConversation(deleteTarget.value, deleteForAll.value)
    deleteTarget.value = ''
  })
}
async function selectAll() {
  await perform(async () => {
    await loadAllMessages()
    selectedMessages.value = messages.value.map((message) => message.id)
  })
}
const displayedMessages = computed(() =>
  messages.value.filter(
    (message) =>
      !messageQuery.value ||
      message.body
        .toLocaleLowerCase()
        .includes(messageQuery.value.toLocaleLowerCase()),
  ),
)
const listedPeers = computed(() =>
  peers.value.filter(
    (peer) =>
      peer.ready &&
      [
        peer.publicId,
        peer.username,
        peer.fields.name,
        peer.fields.username,
      ].some((value) =>
        value
          ?.toLocaleLowerCase()
          .includes(
            contactQuery.value.trim().toLocaleLowerCase().replace(/^@/, ''),
          ),
      ),
  ),
)
watch(
  () => activeChat.value?.deleted,
  (value) => {
    if (value) openRoom('')
  },
)
watch(messages, () => {
  selectedMessages.value = selectedMessages.value.filter((id) =>
    messages.value.some((message) => message.id === id),
  )
})
watch(selected, () => {
  cancelEdit()
  pickerOpen.value = false
  messageSearchOpen.value = false
  messageMenu.value = undefined
  reactionPicker.value = undefined
  selecting.value = false
  selectedMessages.value = []
  messageQuery.value = ''
  cancelPress()
})
const listed = computed(() =>
  rooms.value.filter(room => {
    if (room.deleted || room.membership !== 'join') return false
    if (tab.value === 'archive') { if (!room.archived) return false }
    else {
      if (room.archived) return false
      if (tab.value === 'unread' && room.unread <= 0) return false
      if (tab.value === 'groups' && room.direct) return false
      if (tab.value.startsWith('folder:') &&
          !privateFolders.value.find(folder => folder.id === tab.value.slice(7))?.roomIds.includes(room.id)) return false
    }
    return !listQuery.value || room.name.toLocaleLowerCase().includes(listQuery.value.toLocaleLowerCase())
  }),
)
const pendingInbox = computed(() => {
  if (tab.value !== 'chats') return []
  const latest = new Map<string, typeof pendingDirectTexts.value[number]>()
  for (const item of pendingDirectTexts.value) {
    if (listQuery.value && !item.peerId.toLocaleLowerCase().includes(listQuery.value.toLocaleLowerCase())) continue
    latest.set(item.peerId, item)
  }
  return [...latest.values()].sort((a, b) => b.time - a.time)
})
watch(
  () => [account.value?.id, identityDeviceId.value, appLocked.value] as const,
  () => {
    clearPrivateFolders()
    tab.value = 'chats'
    foldersOpen.value = false
    if (!account.value || appLocked.value) return
    void loadPrivateFolders().catch(() => { folderError.value = ui('folderError') })
  },
  { immediate: true },
)
const pendingEntryPeer = computed(() => {
  const routePeer = typeof route.query.peer === 'string' ? route.query.peer.trim() : ''
  // Restored outbox entries belong in the inbox; Back must not reopen a
  // previously dismissed conversation simply because a queued row exists.
  return routePeer || pendingPeer.value || ''
})
const conversationPresence = usePeerPresence(computed(() =>
  directPeer.value?.id || pendingEntryPeer.value || ''))
watch(pendingEntryPeer, value => { pendingConversationUi.value = !!value }, { immediate: true })
watch(
  [() => account.value?.id, () => identityDeviceId.value, sessionState, appLocked],
  () => {
    if (!appLocked.value && (hasConfirmedIdentity() ||
        (offlineCaptureIdentity.value && ['offline', 'checking'].includes(sessionState.value))))
      void restorePendingDirectOutbox()
  },
  { immediate: true },
)
let pendingOpenAttempt = ''
const pendingAttemptKey = (peer: string) => `${account.value?.id || ''}:${peer}`
function retryPendingConversation() {
  const peer = pendingEntryPeer.value
  if (!peer || actionBusy.value) return
  pendingOpenAttempt = pendingAttemptKey(peer)
  actionError.value = ''
  void writeDirect(peer, pendingCall.value)
}
watch([() => security.value.verified, connection, diagnostic, actionBusy, pendingEntryPeer], () => {
  if (actionBusy.value) return
  if (!pendingEntryPeer.value) { pendingOpenAttempt = ''; return }
  if (decideChatEntry(connection.value, diagnostic.value, security.value.verified).kind !== 'ready' ||
      !pendingEntryPeer.value) return
  const peer = pendingEntryPeer.value
  // Route-driven opens are handled by the route watcher, preventing
  // two async createChat calls when verification finishes.
  if (route.query.peer === peer) return
  const attempt = pendingAttemptKey(peer)
  if (pendingOpenAttempt === attempt) return
  pendingOpenAttempt = attempt
  pendingPeer.value = ''
  securityOpen.value = false
  void writeDirect(peer, pendingCall.value)
}, { immediate: true })
const voiceDirty = ref(false)
const textPersisting = ref(false)
const dirty = computed(
  // Durable queued/sending/not-sent operations are already AES-GCM persisted
  // and survive reload. A plain text composer draft must never trap the user
  // behind the browser's native "unsaved changes" dialog.
  () => voiceDirty.value || !!chosenAttachment.value,
)
guardReload(dirty, recoveryBusy)
function resume(event: PageTransitionEvent) {
  if (event.persisted && account.value) void startMessaging()
}
function visibility() {
  hidden.value = document.hidden
  if (!hidden.value && !profileOpen.value && atBottom.value) void markRead()
}
onMounted(() => {
  void restorePendingDirectOutbox()
  void startMessaging()
  updateViewport()
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.addEventListener('resize', updateViewport)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pageshow', resume)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('pageshow', resume)
  restoreInput.value = ''
  cancelPress()
  cancelEdit()
  clearPrivateFolders()
  clearAttachment()
  clearTimeout(searchTimer)
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.removeEventListener('resize', updateViewport)
  document.documentElement.style.removeProperty('--messenger-viewport')
  stopMessaging()
})
onBeforeRouteLeave(() => {
  // Navigating away is local UI, never a network/Matrix bootstrap or backup
  // barrier. Durable text is already committed before its composer is cleared.
  if (recoveryBusy.value || (callPhase.value !== 'idle' && !confirm(callText('leave'))) ||
      (dirty.value && !confirm(s('leave')))) return false
  void preserveMessageKeys().catch(() => { messageBackupWarning.value = true })
  return true
})

watch(
  () => `${account.value?.id || ''}:${identityDeviceId.value}`,
  (identity, previous) => {
    if (identity !== previous) {
      actionGeneration++
      actionBusy.value = false
      linkedError.value = ''
      linkedPhoto.value = ''
      linkedAttempt = ''
      restoreInput.value = ''
      pendingPeer.value = ''
      directHandle.value = ''
      chatDrafts.clear()
      clearPrivateFolders()
      pickerOpen.value = false
      foldersOpen.value = false
      cancelEdit()
      reactionPicker.value = undefined
      messageMenu.value = undefined
      clearAttachment()
      contactQuery.value = ''
      listQuery.value = ''
      draft.value = ''
      reply.value = ''
      securityOpen.value = false
      newOpen.value = false
      detailsOpen.value = false
      chosen.value = []
      chatName.value = ''
      actionError.value = ''
    }
    if (account.value) void startMessaging()
  },
)

watch(newOpen, (value) => {
  if (value) { pendingPeer.value = ''; pendingCall.value = false; directHandle.value = ''; contactQuery.value = ''; group.value = false; chosen.value = []; actionError.value = ''; void refreshPeers().catch(() => {}) }
})
watch(selected, (id, previous) => {
  if (previous && id !== previous) clearAttachment()
  if (previous) chatDrafts.set(previous, { text: draft.value, reply: reply.value })
  draft.value = chatDrafts.get(id)?.text || ''
  reply.value = chatDrafts.get(id)?.reply || ''
  actionError.value = ''
  void nextTick(() => {
    if (log.value) { log.value.scrollTop = log.value.scrollHeight; atBottom.value = true }
  })
})
watch(
  () => messages.value.at(-1)?.id,
  () => {
    // The composer clears only after its own queueTextMessage succeeds.
    // Never erase typed text based on body equality: identical consecutive
    // messages and interleaved local echoes must remain independent.
    if (!profileOpen.value && atBottom.value) void nextTick(scrollToLatest)
    if (!profileOpen.value && atBottom.value) void markRead()
  },
)
async function perform(action: () => Promise<unknown>) {
  if (actionBusy.value) return
  const version = actionGeneration
  actionBusy.value = true
  actionError.value = ''
  try {
    await action()
  } catch (error) {
    if (version === actionGeneration)
      actionError.value = m(
        error instanceof IdentityError && error.status === 404 ? 'contactUnavailable'
          : error instanceof IdentityError && error.status === 403 ? 'contactBlocked'
          : error instanceof IdentityError && error.status === 503 ? 'serviceUnavailable'
          : error instanceof Error && error.message === 'invalid_peers' ? 'contactNotReady'
          : error instanceof Error && error.message === 'not_ready' ? 'deviceRecoveryHint'
          : 'failed',
      )
  } finally {
    if (version === actionGeneration) actionBusy.value = false
  }
}
async function submitVoice(value: VoiceDraft) {
  if (actionBusy.value) throw new Error('busy')
  const version = actionGeneration
  actionBusy.value = true
  try { await sendVoice(value, reply.value || undefined); if (version === actionGeneration) reply.value = '' }
  finally { if (version === actionGeneration) actionBusy.value = false }
}
async function submitChosenAttachment() {
  const file = chosenAttachment.value, roomId = selected.value, version = actionGeneration
  if (!file || actionBusy.value || attachmentBusy.value) return
  attachmentBusy.value = true
  attachmentError.value = ''
  try {
    await sendAttachment(file, draft.value, reply.value || undefined)
    if (actionGeneration === version && selected.value === roomId && chosenAttachment.value === file) {
      clearAttachment()
      draft.value = ''
      reply.value = ''
    }
  } catch {
    if (actionGeneration === version && selected.value === roomId)
      attachmentError.value = ui('attachmentSendFailed')
  } finally {
    attachmentBusy.value = false
  }
}
async function submitEdit() {
  const target = editingMessage.value
  if (!target || actionBusy.value || selected.value !== target.roomId) return
  const text = draft.value
  if (!text.trim() || text.length > 10000) return
  actionBusy.value = true
  const version = actionGeneration
  try {
    await editMessage(target.id, text)
    if (version === actionGeneration && editingMessage.value?.id === target.id &&
        selected.value === target.roomId) {
      cancelEdit()
      actionError.value = ''
    }
  } catch {
    if (version === actionGeneration && selected.value === target.roomId)
      actionError.value = ui('editFailed')
  } finally {
    if (version === actionGeneration) actionBusy.value = false
  }
}
async function submit() {
  if (actionBusy.value || textPersisting.value || attachmentBusy.value || voiceDirty.value) return
  if (editingMessage.value || chosenAttachment.value) {
    if (connection.value !== 'ready') { actionError.value = m('offline'); return }
    if (editingMessage.value) { void submitEdit(); return }
    void submitChosenAttachment(); return
  }
  const body = draft.value, replyTo = reply.value, photo = linkedPhoto.value
  if (!body.trim()) return
  const roomId = selected.value, ownerId = account.value?.id, version = actionGeneration
  textPersisting.value = true
  try {
    // A local bubble appears synchronously; keep the composer intact until
    // the AES-GCM encrypted outbox transaction actually commits to disk.
    await queueTextMessage(body, replyTo || undefined, photo || undefined)
    if (version !== actionGeneration || ownerId !== account.value?.id || selected.value !== roomId) return
    chatDrafts.delete(roomId)
    if (draft.value === body && reply.value === replyTo && linkedPhoto.value === photo) {
      draft.value = ''; reply.value = ''; linkedPhoto.value = ''
    }
    actionError.value = ''
    if (atBottom.value) void nextTick(scrollToLatest)
  } catch (error) {
    if (version === actionGeneration && ownerId === account.value?.id && selected.value === roomId)
      actionError.value = m(error instanceof Error && error.message === 'not_ready'
        ? 'deviceRecoveryHint' : 'outboxUnavailable')
  } finally { textPersisting.value = false }
}
async function submitPending() {
  const peer = pendingEntryPeer.value
  const body = draft.value.trim()
  if (!peer || !body || textPersisting.value) return
  textPersisting.value = true
  try {
    await queueDirectText(peer, body)
    if (draft.value.trim() === body) draft.value = ''
    actionError.value = ''
    if (!actionBusy.value) void writeDirect(peer)
  } catch { actionError.value = m('outboxUnavailable') }
  finally { textPersisting.value = false }
}
async function newChat() {
  if (!readyToWrite()) return
  const version = actionGeneration
  await perform(async () => {
    await createChat(chosen.value, group.value ? chatName.value : '')
    if (version !== actionGeneration) return
    newOpen.value = false
    chatName.value = ''
    chosen.value = []
  })
}
async function restore() {
  const version = actionGeneration
  await restoreHistory(restoreInput.value)
  if (version === actionGeneration && !recoveryError.value)
    restoreInput.value = ''
}
async function leave() {
  const version = actionGeneration
  if (confirm(m('leaveQuestion')))
    await perform(async () => {
      await leaveChat()
      if (version === actionGeneration) detailsOpen.value = false
    })
}
async function block() {
  const version = actionGeneration
  if (confirm(m('block')))
    await perform(async () => {
      await blockContact()
      if (version === actionGeneration) detailsOpen.value = false
    })
}
const replyBody = (id: string) =>
  messages.value.find((message) => message.id === id)?.body || ui('deletedMessage')

function startEditMessage(message: Message) {
  if (!canEditMessage(message.id) || chosenAttachment.value || voiceDirty.value ||
      actionBusy.value || editingMessage.value) return
  editSnapshot = { text: draft.value, reply: reply.value }
  editingMessage.value = { id: message.id, roomId: selected.value, original: message.body }
  draft.value = message.body
  reply.value = ''
  messageMenu.value = undefined
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('.chatify-message-composer textarea')?.focus())
}

const reactionPicker = ref<Message>()
const messageSearchOpen = ref(false), messageMenu = ref<Message>(), chatMenu = ref(''), atBottom = ref(true), highlighted = ref('')
const messageDeleteOpen = ref(false), messageDeleteEveryone = ref(false), deletingMessages = ref<string[]>([])
const viewport = ref(window.visualViewport?.height ?? window.innerHeight)
const archiveCount = computed(() => rooms.value.filter(room => !room.deleted && room.archived && room.membership === 'join').length)
const timeline = computed(() => displayedMessages.value.map((message, index, all) => {
  const previous = all[index - 1]
  const day = !previous || new Date(previous.time).toDateString() !== new Date(message.time).toDateString()
  return { message, day, dayLabel: day ? dayLabel(message.time) : '', grouped: !day && previous?.mine === message.mine && previous.sender === message.sender && message.time - previous.time < 180000 }
}))
function updateViewport() { viewport.value = window.visualViewport?.height ?? window.innerHeight; document.documentElement.style.setProperty('--messenger-viewport', viewport.value + 'px') }
function scrollToLatest() { if (log.value && !profileOpen.value && !hidden.value) { log.value.scrollTop = log.value.scrollHeight; atBottom.value = true; void markRead() } }
watch(profileOpen, open => { if (!open && atBottom.value) void nextTick(scrollToLatest) })
function scrolled() {
  if (!log.value || profileOpen.value || hidden.value) return
  const previouslyBottom = atBottom.value
  atBottom.value = log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 80
  if (atBottom.value && !previouslyBottom) void markRead()
  if (log.value.scrollTop < 60 && log.value.scrollHeight > log.value.clientHeight + 100 && olderAvailable.value && !historyBusy.value && !actionBusy.value) void older()
}
async function older() {
  const element = log.value, roomId = selected.value
  const height = element?.scrollHeight ?? 0, top = element?.scrollTop ?? 0
  await perform(olderMessages); await nextTick()
  if (element && log.value === element && selected.value === roomId) {
    element.scrollTop = top + element.scrollHeight - height
  }
}
async function jumpToMessage(id: string) {
  const roomId = selected.value
  messageQuery.value = ''; messageSearchOpen.value = false
  if (!messages.value.some(message => message.id === id)) await perform(loadAllMessages)
  if (selected.value !== roomId || hidden.value || profileOpen.value) return
  await nextTick()
  if (selected.value !== roomId) return
  const element = [...log.value?.querySelectorAll<HTMLElement>('[data-event-id]') ?? []].find(item => item.dataset.eventId === id)
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  highlighted.value = id
  setTimeout(() => { if (highlighted.value === id) highlighted.value = '' }, 2000)
}
function chooseRoom(id: string) { if (voiceDirty.value && !confirm(voiceText('discard'))) return; openRoom(id) }
async function openSearchResult(roomId: string, id: string) { openRoom(roomId); await nextTick(); await jumpToMessage(id) }
async function copyMessage() { const text = messageMenu.value?.body; if (text) await navigator.clipboard.writeText(text) }
function selectMessage(message: Message) {
  selecting.value = true; selectedMessages.value = [message.id]; messageMenu.value = undefined
}
function cancelSelection() { selecting.value = false; selectedMessages.value = [] }
function closeNewMessage() { newOpen.value = false; pendingPeer.value = '' }
function closePendingConversation() {
  actionGeneration++
  pendingPeer.value = ''
  pendingCall.value = false
  actionError.value = ''
  if (route.query.peer)
    void router.replace({ query: { ...route.query, peer: undefined, call: undefined } })
}
function toggleMessage(id: string) {
  selectedMessages.value = selectedMessages.value.includes(id) ? selectedMessages.value.filter(value => value !== id) : [...selectedMessages.value, id]
}
function askMessageDelete(ids: string[], everyone = false) {
  deletingMessages.value = [...ids]; messageDeleteEveryone.value = everyone && canDeleteForEveryone(ids); messageDeleteOpen.value = true; messageMenu.value = undefined
}
type MessageActionId = 'reply' | 'copy' | 'pin' | 'select' | 'retry' | 'delete' | 'edit' | 'react'
const messageActions = computed(() => {
  const item = messageMenu.value
  const actions: { id: MessageActionId; label: string; destructive?: boolean }[] = []
  if (!item) return actions
  if (!item.locked && item.status !== 'sending') {
    actions.push({ id: 'copy', label: a('copy') })
    if (item.status !== 'notSent') {
      actions.unshift({ id: 'reply', label: m('reply') })
      actions.push({ id: 'react', label: ui('react') })
      if (canEditMessage(item.id) && !editingMessage.value && !chosenAttachment.value && !voiceDirty.value)
        actions.push({ id: 'edit', label: ui('edit') })
      if (canPinMessage()) actions.push({ id: 'pin', label: ui(pinnedIds.value.includes(item.id) ? 'unpin' : 'pin') })
    }
  }
  actions.push({ id: 'select', label: ui('selectOne') })
  if (item.status === 'notSent') {
    actions.push({ id: 'retry', label: m('retrySend') })
    actions.push({ id: 'delete', label: ui('delete'), destructive: true })
  } else if (item.status !== 'sending') {
    actions.push({ id: 'delete', label: ui('delete'), destructive: true })
  }
  return actions
})
function handleMessageAction(id: MessageActionId) {
  const item = messageMenu.value
  if (!item || !messageActions.value.some(action => action.id === id)) return
  switch (id) {
    case 'reply': reply.value = item.id; messageMenu.value = undefined; break
    case 'edit': startEditMessage(item); break
    case 'react': reactionPicker.value = item; messageMenu.value = undefined; break
    case 'copy': void perform(copyMessage); messageMenu.value = undefined; break
    case 'pin': void perform(() => pinMessage(item.id, !pinnedIds.value.includes(item.id))); messageMenu.value = undefined; break
    case 'select': selectMessage(item); break
    case 'retry': void perform(() => retryMessage(item.id)); messageMenu.value = undefined; break
    case 'delete': askMessageDelete([item.id]); break
  }
}
function handleReaction(id: string, key: string) {
  if (!isReactionKey(key) || connection.value !== 'ready' || !security.value.verified ||
      actionBusy.value) return
  void perform(() => toggleReaction(id, key))
}
function applyPickedReaction(key: ReactionKey) {
  const target = reactionPicker.value
  reactionPicker.value = undefined
  if (target) handleReaction(target.id, key)
}
async function confirmMessageDelete() {
  await perform(async () => { await deleteMessages(deletingMessages.value, messageDeleteEveryone.value); messageDeleteOpen.value = false; selectedMessages.value = []; selecting.value = false })
}
let pressTimer: ReturnType<typeof setTimeout> | undefined, pressX = 0, pressY = 0
function cancelPress() { clearTimeout(pressTimer); pressTimer = undefined }
function press(event: PointerEvent, message: Message) {
  if (event.pointerType === 'mouse' || event.button !== 0 || selecting.value) return
  pressX = event.clientX; pressY = event.clientY
  cancelPress(); pressTimer = setTimeout(() => { messageMenu.value = message; pressTimer = undefined }, 450)
}
function movePress(event: PointerEvent) { if (Math.abs(event.clientX - pressX) > 12 || Math.abs(event.clientY - pressY) > 12) cancelPress() }
function releasePress(event: PointerEvent, message: Message) {
  if (event.pointerType !== 'mouse' && !selecting.value && !message.locked && message.status !== 'sending' && message.status !== 'notSent' && event.clientX - pressX > 65 && Math.abs(event.clientY - pressY) < 35) reply.value = message.id
  cancelPress()
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(directHandle, value => { contactQuery.value = value; actionError.value = ''; pendingPeer.value = ''; pendingCall.value = false })
watch(listQuery, query => {
  clearTimeout(searchTimer); cancelMessageSearch()
  if (query.trim().length > 1) searchTimer = setTimeout(() => { void searchMessages(query).catch(() => { actionError.value = m('failed') }) }, 350)
})
watch(messageSearchOpen, open => { if (open) { void perform(loadAllMessages); void nextTick(() => document.querySelector<HTMLInputElement>('.conversation-search input')?.focus()) } else messageQuery.value = '' })
</script>
<template>
  <section class="native-screen messages-screen" :class="{ 'has-conversation': !!activeChat || !!pendingEntryPeer }" :style="{ '--messenger-viewport': viewport + 'px' }" :data-room="selected" :data-connection="connection" :data-crypto-stage="diagnostic" :data-device-verified="security.verified" :data-history-backup="security.backup" :data-discussion-state="linkedErrorCode">
    <CallPanel v-if="!hidden" />
    <div v-if="hidden" class="native-empty"><AppIcon name="lock" /><h2>{{ m('privacy') }}</h2></div>
    <RouterView v-else-if="profileOpen" v-slot="{ Component }"><component :is="Component" in-messages @message="profileMessage" @call="(id: string) => profileMessage(id, true)" /></RouterView>
    <template v-if="!hidden">
      <MessengerSplitLayout v-show="!profileOpen">
        <aside class="messenger-sidebar" :aria-label="m('chats')">
          <SidebarHeader
            :title="tab === 'contacts' ? a('contacts') : u('messages')"
            :subtitle="connection === 'ready' ? '' : connection === 'offline' ? ui('offlineShort') : m('connecting')"
          >
            <template #leading>
              <button v-if="tab === 'contacts'" class="app-icon-button" :aria-label="s('back')" @click="tab = 'chats'"><AppIcon name="back" /></button>
            </template>
            <template #actions>
              <button class="app-icon-button" :aria-label="a('contacts')" :aria-pressed="tab === 'contacts'" @click="tab = tab === 'contacts' ? 'chats' : 'contacts'"><AppIcon name="users" /></button>
              <button class="app-icon-button" :aria-label="ui('folderManage')" @click="foldersOpen = true"><AppIcon name="folder" /></button>
              <button class="app-icon-button messenger-compose-button" :aria-label="m('newChat')" @click="newOpen = true"><AppIcon name="plus" /></button>
            </template>
          </SidebarHeader>
          <div v-if="['error', 'otherTab', 'unsupported'].includes(connection)" class="messenger-connection-error" role="status">
            <p>{{ m(connection === 'otherTab' ? 'otherTab' : connection === 'unsupported' ? 'unsupported' : failure || 'failed') }}</p>
            <button v-if="failure === 'keysUnavailable'" class="quiet-button" @click="router.push('/profile/account?mode=recover')">{{ m('newDevice') }}</button>
            <button v-else class="quiet-button" @click="startMessaging">{{ m('retry') }}</button>
          </div>
          <div v-if="incomingError" class="messenger-connection-error" role="status"><p>{{ m('failed') }}</p><button class="quiet-button" @click="joinIncomingConversations(true)">{{ m('retry') }}</button></div>
          <p v-if="actionError && !activeChat && !pendingEntryPeer && !newOpen" class="message-error form-error" role="alert">{{ actionError }}</p>
          <ContactsView v-if="tab === 'contacts'" embedded @profile="openPerson" />
          <template v-else>
            <ConversationSearch
              v-model="listQuery"
              :placeholder="ui('search')"
              :clear-label="ui('clearSearch')"
              :history-label="ui(searchBusy ? 'searching' : 'searchHistory')"
              :searching="searchBusy"
              @search-history="perform(() => searchMessages(listQuery))"
            />
            <div class="messenger-filters" :aria-label="m('chats')">
              <button :aria-pressed="tab === 'chats'" @click="tab = 'chats'">{{ m('chats') }}</button>
              <button :aria-pressed="tab === 'unread'" @click="tab = 'unread'">{{ ui('unreadOnly') }}</button>
              <button :aria-pressed="tab === 'groups'" @click="tab = 'groups'">{{ ui('groupOnly') }}</button>
              <button v-for="folder in privateFolders" :key="folder.id" :aria-pressed="tab === 'folder:' + folder.id" @click="tab = 'folder:' + folder.id">{{ folder.name }}</button>
              <button v-if="archiveCount || tab === 'archive'" :aria-pressed="tab === 'archive'" @click="tab = 'archive'">{{ ui('archive') }}<span v-if="archiveCount">{{ archiveCount }}</span></button>
            </div>
            <div class="messenger-chat-list">
              <div v-if="connection === 'connecting' && !listed.length && !pendingInbox.length" class="chat-skeletons" aria-hidden="true"><div v-for="i in 4" :key="i"><i /><span><b /><b /></span></div></div>
              <template v-else>
                <button v-for="item in pendingInbox"
                  :key="item.peerId" type="button" class="chat-row chatify-conversation-item"
                  @click="writeDirect(item.peerId)">
                  <span :class="['chat-avatar', avatarColor(item.peerId)]">{{ initials(item.peerId) }}</span>
                  <span class="chat-summary">
                    <span class="chat-summary-title"><strong>{{ item.peerId }}</strong></span>
                    <span class="chat-summary-preview"><span>{{ item.body }}</span><small>{{ m('queued') }}</small></span>
                  </span>
                </button>
                <div v-for="room in listed" :key="room.id" class="chat-swipe-row" @touchstart="event => { swipeX = event.touches[0]?.clientX ?? 0; swipeY = event.touches[0]?.clientY ?? 0 }" @touchend="endSwipe($event, room.id)" @contextmenu.prevent="chatMenu = room.id">
                  <div v-if="swiped === room.id" class="chat-swipe-actions"><button :aria-label="ui(room.archived ? 'unarchive' : 'archiveAction')" @click="perform(() => archiveConversation(room.id, !room.archived)); swiped = ''"><AppIcon name="archive" /></button><button :aria-label="ui('deleteChat')" @click="askDelete(room.id)"><AppIcon name="trash" /></button></div>
                  <ConversationListItem
                    :conversation="{ id: room.id, name: room.name, avatarClass: avatarColor(room.id), avatarInitials: initials(room.name), group: !room.direct, timeLabel: chatTime(room.lastTime), preview: (room.lastMine && room.preview ? m('you') + ': ' : '') + (room.preview || ui('noMessages')), unreadCount: room.unread, muted: room.muted }"
                    :active="selected === room.id"
                    :swiped="swiped === room.id"
                    @select="swiped ? swiped = '' : chooseRoom(room.id)"
                  />
                  <button v-if="swiped !== room.id" class="app-icon-button chat-row-menu" :aria-label="ui('chatActions')" @click="chatMenu = room.id"><AppIcon name="more" /></button>
                </div>
                <button v-for="hit in searchResults" :key="hit.id" class="search-result" @click="openSearchResult(hit.roomId, hit.id)"><span class="search-result-label">{{ hit.roomName }}</span><span>{{ hit.body }}</span><AppIcon name="search" /></button>
                <div v-if="!listed.length && !pendingInbox.length && !searchResults.length" class="native-empty messenger-empty"><AppIcon :name="listQuery ? 'search' : tab === 'archive' ? 'archive' : 'messages'" /><h2>{{ listQuery ? ui('noMatches') : tab === 'archive' ? ui('archive') : m('empty') }}</h2><p>{{ tab.startsWith('folder:') ? ui('folderEmpty') : listQuery ? ui('noMatchesHint') : ui('emptyHint') }}</p><button v-if="!listQuery && tab === 'chats'" class="primary-button" @click="newOpen = true">{{ ui('newMessage') }}</button></div>
              </template>
            </div>
          </template>
        </aside>
        <main class="messenger-thread" :class="{ 'messenger-thread-placeholder': !activeChat && !pendingEntryPeer }" :aria-label="activeChat?.name || pendingEntryPeer || ui('threadEmpty')">
          <template v-if="activeChat">
            <ThreadHeader
              :name="selecting ? formatNumber(selectedMessages.length) + ' ' + ui('messageSelected').toLocaleLowerCase() : activeChat.name"
              :subtitle="connection === 'offline' ? ui('offlineShort') : activeChat.direct ? presenceLabel(conversationPresence) : membersCount(activeChat.members.length)"
              :avatar-class="avatarColor(activeChat.id)"
              :initials="initials(activeChat.name)"
              :group="!activeChat.direct"
              :selecting="selecting"
              :show-back="true"
              :back-label="selecting ? ui('cancelSelection') : s('back')"
              :open-label="activeChat.name"
              @back="selecting ? cancelSelection() : chooseRoom('')"
              @open="directPeer ? openPerson(directPeer.id) : detailsOpen = true"
            >
              <template #actions>
                <template v-if="selecting"><button class="app-icon-button" :aria-label="ui('selectAll')" :disabled="historyBusy" @click="selectAll"><AppIcon name="check" /></button></template>
                <template v-else>
                  <button v-if="callsEnabled && activeChat.membership === 'join' && activeChat.encrypted && !activeChat.blocked && security.verified" class="app-icon-button messenger-audio-call" :aria-label="callText('audio')" :disabled="connection !== 'ready' || callPhase !== 'idle'" @click="joinCall(selected, false)"><AppIcon name="phone" /></button>
                  <button v-if="!messageSearchOpen" class="app-icon-button" :aria-label="ui('searchChat')" @click="messageSearchOpen = !messageSearchOpen"><AppIcon name="search" /></button>
                  <button class="app-icon-button" :aria-label="ui('chatActions')" @click="chatMenu = selected"><AppIcon name="more" /></button>
                </template>
              </template>
            </ThreadHeader>
            <div v-if="activeChat.membership !== 'join'" class="messenger-joining" role="status"><p>{{ personText('opening') }}</p><button v-if="incomingError" class="quiet-button" @click="joinIncomingConversations(true)">{{ personText('retry') }}</button></div>
            <div class="conversation">
              <div v-if="messageSearchOpen" class="messenger-search conversation-search"><AppIcon name="search" /><input v-model="messageQuery" type="search" :aria-label="ui('searchChat')" :placeholder="ui('searchChat')" /><button class="app-icon-button" :aria-label="ui('closeSearch')" @click="messageSearchOpen = false"><AppIcon name="close" /></button></div>
              <button v-if="pinnedIds.length" class="pinned-strip" @click="jumpToMessage(pinnedIds[0]!)"><span class="pinned-indicator" /><span><strong>{{ ui('pinned') }}<small v-if="pinnedIds.length > 1"> · {{ pinnedIds.length }}</small></strong><span>{{ messages.find(message => message.id === pinnedIds[0])?.body || ui('pinned') }}</span></span><AppIcon name="chevron" /></button>
              <div ref="log" class="message-log" role="log" aria-live="polite" :aria-label="u('messages')" @scroll="scrolled">
                <p v-if="historyBusy || openingHistory" class="history-loading" role="status">{{ ui('loadingHistory') }}</p>
                <p v-if="openingHistoryError" class="form-error" role="alert">{{ ui('historyFailed') }}<button class="quiet-button" @click="loadInitialHistory(true)">{{ personText('retry') }}</button></p>
                <div v-if="!messages.length" class="thread-start"><span>{{ ui('firstMessage') }}</span></div>
                <MessageList :items="timeline" v-slot="{ item }">
                  <MessageBubble
                    :id="item.message.id"
                    :mine="item.message.mine"
                    :locked="item.message.locked"
                    :grouped="item.grouped"
                    :highlighted="highlighted === item.message.id"
                    :selected="selectedMessages.includes(item.message.id)"
                    :selecting="selecting"
                    :sender="item.message.sender"
                    :show-sender="!activeChat.direct && !item.message.mine && !item.grouped"
                    :body="item.message.body"
                    :time-label="formatDate(item.message.time, { hour: '2-digit', minute: '2-digit' })"
                    :status="item.message.status"
                    :status-label="m(item.message.status)"
                    :menu-label="ui('messageActions')"
                    :select-label="ui('selectOne') + ': ' + item.message.body"
                    :reply-id="item.message.reply"
                    :reply-preview="item.message.reply ? replyBody(item.message.reply) : undefined"
                    :has-voice="!!item.message.voice"
                    :has-photo="!!item.message.photoId"
                    :has-attachment="!!item.message.attachment"
                    :edited="item.message.edited"
                    :edited-label="ui('edited')"
                    :reactions="item.message.reactions"
                    :reaction-label="ui('react')"
                    @react="handleReaction(item.message.id, $event)"
                    @menu="messageMenu = item.message"
                    @toggle="toggleMessage(item.message.id)"
                    @reply-jump="jumpToMessage"
                    @press-start="press($event, item.message)"
                    @press-move="movePress"
                    @press-end="releasePress($event, item.message)"
                    @press-cancel="cancelPress"
                  >
                    <template #voice>
                      <VoiceMessagePlayer
                        v-if="item.message.voice && !item.message.locked"
                        :duration="item.message.voice.duration"
                        :waveform="item.message.voice.waveform"
                        :active="!profileOpen && !hidden"
                        :load="signal => loadVoice(item.message, signal)"
                      />
                    </template>
                    <template #attachment>
                      <EncryptedAttachmentView
                        v-if="item.message.attachment"
                        :key="item.message.id"
                        :kind="item.message.attachment.kind"
                        :name="item.message.attachment.name"
                        :size="item.message.attachment.size"
                        :active="!profileOpen && !hidden && security.verified && selected === activeChat.id"
                        :load="signal => loadAttachment(item.message, signal)"
                        :open-label="ui('attachmentOpen')"
                        :download-label="ui('attachmentDownload')"
                        :loading-label="ui('attachmentLoading')"
                        :error-label="ui('attachmentFailed')"
                      />
                    </template>
                    <template #photo>
                      <button
                        v-if="item.message.photoId && !item.message.locked"
                        class="message-photo"
                        @click.stop="router.push(`/gallery/${item.message.photoId}`)"
                      ><AppIcon name="gallery" />{{ w('openPhoto') }}</button>
                    </template>
                  </MessageBubble>
                </MessageList>
                <div v-if="messageQuery && !displayedMessages.length" class="thread-start">{{ ui('noMatches') }}</div>
              </div>
              <ScrollToBottomButton v-if="!atBottom" :label="ui('jump')" @click="scrollToLatest" />
              <div v-if="selecting" class="message-selection"><button class="quiet-button" :disabled="!selectedMessages.length || actionBusy" @click="askMessageDelete(selectedMessages, false)">{{ ui('deleteMine') }}</button><button v-if="canDeleteForEveryone(selectedMessages)" class="quiet-button" :disabled="!selectedMessages.length || actionBusy" @click="askMessageDelete(selectedMessages, true)">{{ ui('deleteAll') }}</button></div>
              <p v-else-if="!activeChat.encrypted || activeChat.blocked" class="message-error form-error" role="alert">{{ m(activeChat.blocked ? 'blocked' : 'unencrypted') }}</p>
              <template v-else>
                <MessageComposer
                ref="composer"
                v-model="draft"
                :placeholder="m('message')"
                :input-label="m('message')"
                :send-label="editingMessage ? ui('saveEdit') : m('send')"
                :cancel-reply-label="editingMessage ? ui('cancelEdit') : m('cancelReply')"
                :reply-label="editingMessage ? ui('editing') : m('reply')"
                :reply-preview="editingMessage ? editingMessage.original : reply ? replyBody(reply) : undefined"
                :voice-dirty="voiceDirty"
                :disabled="actionBusy || textPersisting || attachmentBusy || ((connection !== 'ready' || !security.verified) && !!(chosenAttachment || editingMessage))"
                :allow-draft-when-disabled="connection === 'offline' && security.verified && !actionBusy && !textPersisting && !attachmentBusy"
                :attachment="chosenAttachment ? { name: chosenAttachment.name, kind: chosenAttachment.type.startsWith('image/') ? 'image' : 'file', size: chosenAttachment.size, preview: attachmentPreviewUrl } : undefined"
                :attachment-busy="attachmentBusy"
                :attach-label="editingMessage || !security.verified ? undefined : ui('attachmentAdd')"
                :allow-attachments="security.verified && !editingMessage"
                :picker-label="ui('pickerTitle')"
                :remove-attachment-label="ui('attachmentRemove')"
                @submit="submit"
                @attach="attachmentInput?.click()"
                @open-picker="pickerOpen = true"
                @select-file="acceptAttachment"
                @remove-attachment="clearAttachment"
                @cancel-reply="editingMessage ? cancelEdit() : reply = ''"
              >
                <template #voice>
                  <input ref="attachmentInput" class="visually-hidden" tabindex="-1" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,application/zip,.pdf,.txt,.zip" :aria-label="ui('attachmentAdd')" @change="chooseAttachment" />
                  <VoiceRecorder
                    v-show="!editingMessage && !chosenAttachment && (!draft.trim() || voiceDirty)"
                    :key="selected"
                    :disabled="actionBusy || connection !== 'ready' || !security.verified"
                    :active="!profileOpen && !hidden"
                    :send="submitVoice"
                    @dirty="voiceDirty = $event"
                  />
                </template>
                </MessageComposer>
              </template>
              <p v-if="attachmentBusy" class="field-hint chatify-attachment-status" role="status">{{ ui('attachmentSending') }}</p>
              <p v-if="attachmentError" class="form-error" role="alert">{{ attachmentError }}</p>
              <p v-if="chosenAttachment && !attachmentBusy" class="field-hint chatify-attachment-privacy">{{ ui('attachmentOriginalNote') }}</p>
            </div>
            <p v-if="linkedError" class="form-error message-error" role="alert">{{ linkedError }}<button class="quiet-button" @click="enterDiscussion">{{ w('retry') }}</button></p>
            <p v-if="actionError" class="form-error message-error" role="alert">{{ actionError }}</p>
          <!-- Old history backup health is visible in Security, not as a
               repeating error banner beneath every fresh conversation. -->
          <p v-if="outboxError" class="form-error message-error" role="alert">{{ m('outboxUnavailable') }}</p>
          </template>
          <template v-else-if="pendingEntryPeer">
            <ThreadHeader
              :name="foundPerson?.fields.name || foundPerson?.fields.username || pendingEntryPeer"
              :subtitle="connection === 'ready' ? personText('opening') : m('queued')"
              :avatar-class="avatarColor(pendingEntryPeer)"
              :initials="initials(foundPerson?.fields.name || foundPerson?.fields.username || pendingEntryPeer)"
              :group="false"
              :show-back="true"
              :back-label="s('back')"
              :open-label="pendingEntryPeer"
              @back="closePendingConversation"
              @open="openPerson(pendingEntryPeer)"
            />
            <div v-if="actionError" class="messenger-connection-error" role="alert"><p>{{ actionError }}</p><button class="quiet-button" :disabled="actionBusy" @click="retryPendingConversation">{{ personText('retry') }}</button></div>
            <div class="conversation">
              <div class="message-log" role="log" aria-live="polite" :aria-label="u('messages')">
                <div v-if="!pendingDirectTexts.some(value => value.peerId === pendingEntryPeer)" class="thread-start"><span>{{ ui('firstMessage') }}</span></div>
                <MessageBubble
                  v-for="item in pendingDirectTexts.filter(value => value.peerId === pendingEntryPeer)"
                  :id="item.id"
                  :key="item.id"
                  :mine="true"
                  :locked="false"
                  :grouped="false"
                  :highlighted="false"
                  :selected="false"
                  :selecting="false"
                  sender=""
                  :show-sender="false"
                  :body="item.body"
                  :time-label="formatDate(item.time, { hour: '2-digit', minute: '2-digit' })"
                  status="queued"
                  :status-label="m('queued')"
                  :menu-label="ui('messageActions')"
                  :select-label="ui('selectOne') + ': ' + item.body"
                  :has-voice="false"
                  :has-photo="false"
                />
              </div>
              <MessageComposer
                ref="composer"
                v-model="draft"
                :placeholder="m('message')"
                :input-label="m('message')"
                :send-label="m('send')"
                :cancel-reply-label="m('cancelReply')"
                :reply-label="m('reply')"
                :voice-dirty="false"
                :disabled="textPersisting"
                :allow-attachments="false"
                @submit="submitPending"
                @cancel-reply="reply = ''"
              />
            </div>
          </template>
          <div v-else class="messenger-desktop-empty"><span class="service-emblem"><AppIcon name="messages" /></span><h2>{{ ui('threadEmpty') }}</h2><p>{{ ui('threadEmptyHint') }}</p></div>
        </main>
      </MessengerSplitLayout>
    </template>
    <AppSheet :open="newOpen && !hidden" :title="group ? ui('newGroup') : ui('newMessage')" :busy="actionBusy" @close="closeNewMessage">
      <form class="new-message-sheet" @submit.prevent="group ? newChat() : findPerson()">
        <template v-if="!group"><button type="button" class="messenger-action" @click="group = true; directHandle = ''"><span class="action-icon"><AppIcon name="users" /></span>{{ ui('newGroup') }}<AppIcon name="chevron" /></button><button type="button" class="messenger-action" @click="newOpen = false; tab = 'contacts'"><span class="action-icon"><AppIcon name="plus" /></span>{{ m('addContact') }}<AppIcon name="chevron" /></button></template>
        <label v-if="group" class="native-form new-group-name">{{ m('chatName') }}<input v-model="chatName" maxlength="80" required /></label>
        <div class="messenger-search"><AppIcon name="search" /><input v-model="directHandle" :aria-label="ui('lookup')" :placeholder="ui('lookupHint')" autocapitalize="off" spellcheck="false" autocomplete="off" /><button v-if="!group" type="submit" class="app-icon-button" :aria-label="s('search')" :disabled="lookupBusy || !directHandle.trim()"><AppIcon name="chevron" /></button></div>
        <p v-if="lookupBusy" class="field-hint" role="status">{{ ui('findingPerson') }}</p>
        <article v-if="foundPerson && !group" class="messenger-found-person" :aria-label="ui('personFound')">
          <button type="button" class="messenger-person" :aria-label="personText('open')" @click="openPerson(foundPerson.publicId)"><span :class="['chat-avatar', avatarColor(foundPerson.publicId)]">{{ initials(foundPerson.fields.name || foundPerson.username || foundPerson.publicId) }}</span><span><strong>{{ foundPerson.fields.name || (foundPerson.username ? '@' + foundPerson.username : foundPerson.publicId) }}</strong><small v-if="foundPerson.username">@{{ foundPerson.username }}</small></span><AppIcon name="chevron" /></button>
          <p class="person-public-id">{{ foundPerson.publicId }}</p>
          <p v-if="foundPerson.fields.about" class="person-about">{{ foundPerson.fields.about }}</p>
          <dl v-if="foundPerson.fields.email || foundPerson.fields.phone || foundPerson.fields.links" class="native-facts"><template v-for="field in (['email', 'phone', 'links'] as const)" :key="field"><div v-if="foundPerson.fields[field]"><dt>{{ a(field) }}</dt><dd>{{ foundPerson.fields[field] }}</dd></div></template></dl>
          <div class="person-primary-actions"><button type="button" class="primary-button" :disabled="actionBusy" @click="writeDirect(foundPerson.publicId)"><AppIcon name="messages" />{{ actionBusy ? personText('opening') : ui('write') }}</button><button type="button" class="secondary-button" :disabled="actionBusy || !callsEnabled || callPhase !== 'idle'" @click="writeDirect(foundPerson.publicId, true)"><AppIcon name="phone" />{{ callText('audio') }}</button></div>
          <p v-if="!callsEnabled" class="field-hint">{{ ui('callsUnavailable') }}</p>
          <p v-else-if="callPhase !== 'idle'" class="field-hint">{{ callText('busy') }}</p>
        </article>
        <p v-if="lookupError && !listedPeers.length" class="field-hint" role="status">{{ lookupError === 'missing' ? m('contactUnavailable') : ui('lookupFailed') }}</p>
        <p v-if="!listedPeers.length && !foundPerson && !lookupBusy && !lookupError" class="new-message-empty">{{ directHandle ? ui('noMatches') : m('noContacts') }}</p>
        <template v-for="peer in listedPeers.filter(peer => peer.publicId !== foundPerson?.publicId)" :key="peer.publicId">
          <label v-if="group" class="messenger-person"><span :class="['chat-avatar', avatarColor(peer.publicId)]">{{ initials(peer.fields.name || peer.username || peer.publicId) }}</span><span><strong>{{ peer.fields.name || (peer.username ? '@' + peer.username : peer.fields.username || peer.publicId) }}</strong><small>{{ peer.username ? '@' + peer.username : peer.publicId }}</small></span><input v-model="chosen" type="checkbox" :aria-label="peer.publicId" :value="peer.publicId" /></label>
          <button v-else type="button" class="messenger-person picker-row" :disabled="actionBusy" @click="writeDirect(peer.publicId)"><span :class="['chat-avatar', avatarColor(peer.publicId)]">{{ initials(peer.fields.name || peer.username || peer.publicId) }}</span><span><strong>{{ peer.fields.name || (peer.username ? '@' + peer.username : peer.fields.username || peer.publicId) }}</strong><small>{{ peer.username ? '@' + peer.username : peer.publicId }}</small></span><AppIcon name="chevron" /></button>
        </template>
        <button v-if="group" class="primary-button" :disabled="actionBusy || !chosen.length || !chatName.trim()">{{ m('create') }}<span v-if="chosen.length" aria-hidden="true"> · {{ chosen.length }}</span></button>
        <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
      </form>
    </AppSheet>
    <AppSheet :open="!!messageMenu && !hidden" :title="ui('messageActions')" :busy="actionBusy" @close="messageMenu = undefined">
      <MessageActionList
        v-if="messageMenu"
        :preview="messageMenu.body"
        :actions="messageActions"
        @action="handleMessageAction"
      />
    </AppSheet>
    <AppSheet :open="pickerOpen && !hidden" :title="ui('pickerTitle')" @close="pickerOpen = false">
      <EmojiStickerPicker
        :emoji-title="ui('emojis')"
        :sticker-title="ui('stickers')"
        :select-label="ui('pickerTitle')"
        @emoji="symbol => { composer?.insertText(symbol); pickerOpen = false }"
        @sticker="prepareSticker"
      />
      <p class="field-hint">{{ ui('stickerHint') }}</p>
    </AppSheet>
    <AppSheet :open="foldersOpen && !hidden" :title="ui('folderManage')" :busy="folderBusy" @close="foldersOpen = false">
      <div class="native-form chatify-folder-editor">
        <p class="field-hint">{{ ui('folderPrivate') }}</p>
        <form @submit.prevent="createFolder">
          <label :for="'new-private-folder'">{{ ui('folderName') }}</label>
          <div class="chatify-folder-create">
            <input id="new-private-folder" v-model="folderName" type="text" maxlength="40" autocomplete="off" :disabled="folderBusy" />
            <button class="primary-button" type="submit" :disabled="folderBusy || !folderName.trim() || privateFolders.length >= 30">{{ ui('folderCreate') }}</button>
          </div>
        </form>
        <div v-for="folder in privateFolders" :key="folder.id" class="chatify-folder-row">
          <template v-if="renameFolderId === folder.id">
            <input v-model="renameFolderText" :aria-label="ui('folderName')" maxlength="40" :disabled="folderBusy" />
            <button class="quiet-button" :disabled="folderBusy || !renameFolderText.trim()" @click="saveFolderName">{{ ui('folderSave') }}</button>
          </template>
          <template v-else>
            <span>{{ folder.name }}</span>
            <button class="quiet-button" :disabled="folderBusy" @click="renameFolderId = folder.id; renameFolderText = folder.name">{{ ui('folderRename') }}</button>
            <button class="quiet-button subtle-danger" :disabled="folderBusy" @click="removeFolder(folder.id)">{{ ui('folderRemove') }}</button>
          </template>
        </div>
        <p v-if="folderError" class="form-error" role="alert">{{ folderError }}</p>
      </div>
    </AppSheet>
    <AppSheet :open="!!reactionPicker && !hidden" :title="ui('react')" :busy="actionBusy" @close="reactionPicker = undefined">
      <div class="chatify-emoji-picker" role="group" :aria-label="ui('react')">
        <button v-for="emoji in reactionKeys" :key="emoji" type="button" class="chatify-emoji-option" :aria-label="ui('react') + ': ' + emoji" :disabled="actionBusy" @click="applyPickedReaction(emoji)">{{ emoji }}</button>
      </div>
    </AppSheet>
    <AppSheet :open="!!chatMenu && !hidden" :title="rooms.find(room => room.id === chatMenu)?.name || ui('chatActions')" :busy="actionBusy" @close="chatMenu = ''">
      <button class="messenger-action" :disabled="actionBusy" @click="perform(() => setConversationMuted(chatMenu, !rooms.find(room => room.id === chatMenu)?.muted)); chatMenu = ''">
        <AppIcon name="bell-off" />{{ ui(rooms.find(room => room.id === chatMenu)?.muted ? 'unmute' : 'mute') }}
      </button>
      <div v-if="privateFolders.length" class="chatify-folder-assignments">
        <p class="field-hint">{{ ui('folderManage') }}</p>
        <button v-for="folder in privateFolders" :key="folder.id" class="messenger-action" :disabled="folderBusy" :aria-pressed="folder.roomIds.includes(chatMenu)" @click="assignFolder(folder.id, chatMenu)">
          <AppIcon name="folder" />{{ folder.name }} · {{ ui(folder.roomIds.includes(chatMenu) ? 'folderUnassign' : 'folderAdd') }}
        </button>
        <p v-if="folderError" class="form-error" role="alert">{{ folderError }}</p>
      </div>
      <button v-if="chatMenu === selected" class="messenger-action" @click="messageSearchOpen = true; chatMenu = ''"><AppIcon name="search" />{{ ui('searchChat') }}</button>
      <button v-if="chatMenu === selected" class="messenger-action" @click="selecting = true; selectedMessages = []; chatMenu = ''"><AppIcon name="check" />{{ ui('select') }}</button>
      <button class="messenger-action" @click="perform(() => archiveConversation(chatMenu, !rooms.find(room => room.id === chatMenu)?.archived)); chatMenu = ''; swiped = ''"><AppIcon name="archive" />{{ ui(rooms.find(room => room.id === chatMenu)?.archived ? 'unarchive' : 'archiveAction') }}</button>
      <button v-if="chatMenu === selected" class="messenger-action" @click="detailsOpen = true; chatMenu = ''"><AppIcon name="users" />{{ m('details') }}</button>
      <button v-if="callsEnabled && chatMenu === selected" class="messenger-action" :disabled="connection !== 'ready' || callPhase !== 'idle'" @click="joinCall(selected, true); chatMenu = ''"><AppIcon name="video" />{{ callText('video') }}</button>
      <button class="messenger-action subtle-danger" @click="askDelete(chatMenu); chatMenu = ''"><AppIcon name="trash" />{{ ui('deleteChat') }}</button>
    </AppSheet>
    <AppSheet :open="messageDeleteOpen && !hidden" :title="ui('delete')" :busy="actionBusy" @close="messageDeleteOpen = false">
      <p>{{ ui('messageSelected') }}: {{ deletingMessages.length }}</p><label v-if="canDeleteForEveryone(deletingMessages)" class="check-row"><input v-model="messageDeleteEveryone" type="checkbox" />{{ ui('deleteAll') }}</label><button class="danger-button" :disabled="actionBusy" @click="confirmMessageDelete">{{ ui(messageDeleteEveryone ? 'deleteAll' : 'deleteMine') }}</button><p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
    </AppSheet>
    <AppSheet
      :open="!!deleteTarget && !hidden"
      :title="ui('deleteConversation')"
      :busy="actionBusy || historyBusy"
      @close="deleteTarget = ''"
      ><div class="native-form">
        <p>
          {{ ui('deleteConversationQuestion') }}
        </p>
        <label
          v-if="rooms.find((room) => room.id === deleteTarget)?.direct"
          class="check-row"
          ><input v-model="deleteForAll" type="checkbox" />{{ ui('deleteBoth') }}</label
        >
        <p class="field-hint">
          {{ ui('deleteConversationHint') }}
        </p>
        <button
          class="primary-button"
          :disabled="actionBusy || historyBusy"
          @click="confirmDelete"
        >
          {{ ui(historyBusy ? 'deletingHistory' : 'deleteConversation') }}
        </button>
        <p v-if="actionError" role="alert">{{ actionError }}</p>
      </div></AppSheet
    >
    <AppSheet
      :open="securityOpen && !hidden"
      :title="m('security')"
      :busy="recoveryBusy"
      @close="() => { securityOpen = false; pendingPeer = '' }"
      ><div class="native-form">
        <p class="field-hint">{{ m('singleKeyHint') }}</p>
        <p v-if="security.verified" class="form-notice">{{ m('deviceVerified') }}</p>
        <p v-if="security.backup" class="field-hint">{{ m('backupEnabled') }}</p>
        <button v-if="!accountRecoveryReady" class="primary-button" @click="router.push('/profile/account?mode=connect')">{{ m('connectAccountKey') }}</button>
        <button v-else class="secondary-button" @click="router.push('/profile/photos-security')">{{ m('saveAccountKey') }}</button>
        <template v-if="!security.verified && accountRecoveryReady">
          <p class="field-hint">{{ m('accountRecoveryPending') }}</p>
          <button class="secondary-button" :disabled="recoveryBusy" @click="perform(async () => { await verifyOwnDevice(); securityOpen = false })">{{ m('verifyDevice') }}</button>
          <details v-if="security.storage">
            <summary>{{ m('legacyImport') }}</summary>
            <form class="native-form" @submit.prevent="restore">
              <label>{{ m('legacyHistoryKey') }}<textarea v-model="restoreInput" rows="4" spellcheck="false" autocomplete="off" /></label>
              <button class="primary-button" :disabled="recoveryBusy || !restoreInput.trim()">{{ m('legacyImport') }}</button>
            </form>
          </details>
        </template>
        <p v-if="recoveryError" class="form-error" role="alert">
          {{ m(recoveryError) }}
        </p>
        <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
        <p v-if="restored" class="form-notice" role="status">
          {{ m('restored') }} · {{ restoredKeys }}
        </p>
      </div></AppSheet
    >
    <AppSheet
      :open="detailsOpen && !hidden"
      :title="m('details')"
      :busy="actionBusy"
      @close="detailsOpen = false"
      ><div v-if="activeChat" class="inline-actions">
        <button
          class="secondary-button"
          @click="
            () => {
              perform(() =>
                archiveConversation(selected, !activeChat?.archived),
              )
              detailsOpen = false
            }
          "
        >
          {{ activeChat.archived ? 'Из архива' : 'В архив' }}</button
        ><button
          class="secondary-button subtle-danger"
          @click="
            () => {
              askDelete(selected)
              detailsOpen = false
            }
          "
        >
          Удалить переписку
        </button>
      </div>
      <div v-if="activeChat" class="native-form">
        <p class="field-hint">{{ m('metadataHint') }}</p>
        <p v-for="member in activeChat.members" :key="member.id">
          {{ member.name }}
        </p>
        <p v-if="activeChat.direct" class="field-hint">
          {{ m(peerVerified ? 'verified' : 'notVerified') }}
        </p>
        <button
          v-if="activeChat.direct"
          class="secondary-button"
          @click="perform(verifyContact)"
        >
          {{ m('verify') }}</button
        ><button
          v-if="activeChat.direct"
          class="quiet-button subtle-danger"
          @click="block"
        >
          {{ m('block') }}</button
        ><button class="quiet-button subtle-danger" @click="leave">
          {{ m('leave') }}
        </button>
        <p v-if="actionError" class="form-error" role="alert">
          {{ actionError }}
        </p>
      </div></AppSheet
    >
    <AppSheet
      :open="!!verification && !hidden"
      :title="m('verifyIncoming')"
      :busy="false"
      @close="cancelVerification"
      ><div class="native-form">
        <p class="field-hint">{{ m('verifyHint') }}</p>
        <div v-if="sas" class="sas-grid">
          <span v-for="(emoji, index) in sas.sas.emoji" :key="index"
            ><strong>{{ emoji[0] }}</strong
            ><small>{{ emoji[1] }}</small></span
          >
        </div>
        <template v-if="sas"
          ><button
            class="primary-button"
            @click="perform(() => confirmVerification(true))"
          >
            {{ m('match') }}</button
          ><button
            class="secondary-button"
            @click="perform(() => confirmVerification(false))"
          >
            {{ m('mismatch') }}
          </button></template
        ><button
          v-else-if="verificationPhase === 2 && !verification?.initiatedByMe"
          class="primary-button"
          @click="perform(acceptVerification)"
        >
          {{ m('verifyAccept') }}
        </button>
        <p v-else role="status">
          {{
            m(
              verificationPhase === 6
                ? 'verified'
                : verificationPhase === 5
                  ? 'cancelled'
                  : 'verifyWaiting',
            )
          }}
        </p>
      </div></AppSheet
    >
  </section>
</template>
