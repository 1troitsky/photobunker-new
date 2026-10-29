import { ref, shallowRef } from 'vue'
import type { MatrixClient } from 'matrix-js-sdk'
import type { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc'
import type { Track, Participant } from 'livekit-client'
import { identityRequest, IdentityError } from '../identity/api'
import { account } from '../identity/store'
import type { CallText } from './text'
export const phase = ref<
    'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ending'
  >('idle'),
  error = ref<CallText>(),
  callRoom = ref(''),
  callName = ref(''),
  mic = ref(false),
  camera = ref(false),
  encrypted = ref(false),
  audioBlocked = ref(false),
  startedAt = ref(0),
  enabled = ref(false)
export const incoming = ref<{ roomId: string; name: string; video: boolean }[]>(
  [],
)
export type MediaItem = {
  id: string
  participant: string
  name: string
  mine: boolean
  kind: 'video' | 'audio'
  track: Track
}
export const tracks = shallowRef<MediaItem[]>([]),
  people = ref<
    { id: string; name: string; mine: boolean; camera: boolean; mic: boolean }[]
  >([])
let client: MatrixClient | undefined,
  allowed: (id: string) => boolean = () => false,
  scanTimer: ReturnType<typeof setInterval> | undefined,
  heartbeat: ReturnType<typeof setInterval> | undefined,
  media: ReturnType<(typeof import('./media'))['createMedia']> | undefined,
  session: MatrixRTCSession | undefined,
  ticket = '',
  generation = 0
let detached: (() => void) | undefined
const declined = new Set<string>()
export function bindCalls(
  value: MatrixClient | undefined,
  canUse: (id: string) => boolean = () => false,
) {
  if (client === value) return
  void endCall()
  error.value = undefined
  client = value
  allowed = canUse
  incoming.value = []
  declined.clear()
  enabled.value = false
  if (scanTimer) clearInterval(scanTimer)
  if (!value) return
  const current = value
  void identityRequest<{ enabled: boolean }>('/rtc/config')
    .then((config) => {
      if (client === current) enabled.value = config.enabled
    })
    .catch(() => {})
  const scan = () => {
    if (client !== current) return
    const calls = []
    for (const room of current.getRooms()) {
      if (!allowed(room.roomId)) continue
      const rtc = current.matrixRTC.getRoomSession(room)
      if (!rtc.memberships.length) {
        declined.delete(room.roomId)
        continue
      }
      if (room.roomId === callRoom.value || declined.has(room.roomId)) continue
      if (
        rtc.memberships.some(
          (m) =>
            m.userId !== current.getUserId() ||
            m.deviceId !== current.getDeviceId(),
        )
      )
        calls.push({
          roomId: room.roomId,
          name: room.name,
          video: rtc.getConsensusCallIntent() === 'video',
        })
    }
    incoming.value = calls
  }
  scanTimer = setInterval(scan, 1000)
  scan()
}
export function decline(roomId: string) {
  declined.add(roomId)
  incoming.value = incoming.value.filter((c) => c.roomId !== roomId)
}
function refresh() {
  if (!media) return
  const current = media.room,
    participants: Participant[] = [
      current.localParticipant,
      ...current.remoteParticipants.values(),
    ],
    all: MediaItem[] = [],
    rows = []
  for (const p of participants) {
    const mine = p === current.localParticipant,
      member = session?.memberships.find(
        (m) => `${m.userId}:${m.deviceId}` === p.identity,
      ),
      name = mine
        ? ''
        : member
          ? (client?.getRoom(callRoom.value)?.getMember(member.userId)?.name ??
            member.userId)
          : 'Участник'
    rows.push({
      id: p.identity,
      name: name ?? '',
      mine,
      camera: p.isCameraEnabled,
      mic: p.isMicrophoneEnabled,
    })
    for (const publication of p.trackPublications.values())
      if (
        publication.track &&
        !publication.isMuted &&
        ['video', 'audio'].includes(publication.kind) &&
        (!mine || publication.kind === 'video')
      )
        all.push({
          id: publication.trackSid,
          participant: p.identity,
          name: name ?? '',
          mine,
          kind: publication.kind as 'audio' | 'video',
          track: publication.track,
        })
  }
  tracks.value = all
  people.value = rows
  mic.value = current.localParticipant.isMicrophoneEnabled
  camera.value = current.localParticipant.isCameraEnabled
  encrypted.value =
    current.isE2EEEnabled && current.localParticipant.isE2EEEnabled
  audioBlocked.value = !current.canPlaybackAudio
}
function classify(failure: unknown): CallText {
  if (
    failure instanceof IdentityError &&
    [401, 403, 404, 409].includes(failure.status)
  )
    return 'access'
  if (
    failure instanceof DOMException &&
    ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(
      failure.name,
    )
  )
    return 'denied'
  if (failure instanceof Error && failure.message === 'rtc.unsupported')
    return 'unsupported'
  if (failure instanceof Error && failure.message.startsWith('rtc.crypto'))
    return 'crypto'
  return 'unavailable'
}
export async function joinCall(roomId: string, video = false) {
  if (phase.value !== 'idle') {
    error.value = 'busy'
    return
  }
  const current = client,
    owner = account.value?.id,
    room = current?.getRoom(roomId)
  if (!current || !room || !allowed(roomId) || !enabled.value) {
    error.value = 'access'
    return
  }
  const version = ++generation
  error.value = undefined
  phase.value = 'connecting'
  callRoom.value = roomId
  callName.value = room.name
  startedAt.value = 0
  const valid = () => {
    if (
      version !== generation ||
      current !== client ||
      account.value?.id !== owner ||
      !allowed(roomId)
    )
      throw new Error('rtc.cancelled')
  }
  let ownedMedia: typeof media
  try {
    const [{ createMedia }, lk, rtcSDK] = await Promise.all([
      import('./media'),
      import('livekit-client'),
      import('matrix-js-sdk/lib/matrixrtc'),
    ])
    valid()
    media = createMedia()
    const local = media
    ownedMedia = local
    await local.room.setE2EEEnabled(true)
    valid()
    if (!local.room.localParticipant.isE2EEEnabled)
      throw new Error('rtc.crypto_before_connect')
    // Request capture on the user's action before starting ICE or issuing a short-lived admission.
    local.capture = await lk.createLocalTracks({
      audio: true,
      video: video
        ? { resolution: { width: 640, height: 480, frameRate: 20 } }
        : false,
    })
    valid()
    const admission = await identityRequest<{
      id: string
      jwt: string
      participant: string
      sfuPath: string
      focusPath: string
    }>('/rtc/join', 'POST', { roomId })
    if (
      version !== generation ||
      current !== client ||
      account.value?.id !== owner
    ) {
      void identityRequest(
        `/rtc/admissions/${admission.id}`,
        'DELETE',
        undefined,
        owner,
      ).catch(() => {})
    }
    valid()
    ticket = admission.id
    session = current.matrixRTC.getRoomSession(room)
    const rtc = session
    await rtc.initialMembershipCalculated
    valid()
    let ownReady!: () => void
    const ownKey = new Promise<void>((resolve) => {
      ownReady = resolve
    })
    const onKey = async (
      raw: Uint8Array<ArrayBuffer>,
      index: number,
      _membership: unknown,
      backend: string,
    ) => {
      if (version !== generation) return
      try {
        await local.provider.add(raw, backend, index)
        if (backend === admission.participant) ownReady()
      } catch {
        if (version === generation) {
          error.value = 'crypto'
          void endCall()
        }
      }
    }
    const membershipFailed = () => {
      if (version === generation) {
        error.value = 'unavailable'
        void endCall()
      }
    }
    rtc.on(rtcSDK.MatrixRTCSessionEvent.EncryptionKeyChanged, onKey)
    rtc.on(
      rtcSDK.MatrixRTCSessionEvent.MembershipManagerError,
      membershipFailed,
    )
    const keyWaits = new Map<string, ReturnType<typeof setTimeout>>()
    detached = () => {
      for (const timer of keyWaits.values()) clearTimeout(timer)
      keyWaits.clear()
      rtc.off(rtcSDK.MatrixRTCSessionEvent.EncryptionKeyChanged, onKey)
      rtc.off(
        rtcSDK.MatrixRTCSessionEvent.MembershipManagerError,
        membershipFailed,
      )
    }
    local.room.on(lk.RoomEvent.EncryptionError, (failure, participant) => {
      if (version !== generation) return
      // Receivers can arrive before the Olm key or the worker's key-import acknowledgement.
      // LiveKit drops these frames. Keep E2EE enabled and allow bounded key delivery.
      if (
        ('reason' in failure &&
          failure.reason === lk.CryptorErrorReason.MissingKey) ||
        failure.message?.startsWith('MissingKey:')
      ) {
        const id =
          participant?.identity ??
          ('participantIdentity' in failure &&
          typeof failure.participantIdentity === 'string'
            ? failure.participantIdentity
            : undefined) ??
          admission.participant
        const hasKey = () =>
          local.provider.getKeys().some((key) => key.participantIdentity === id)
        if (!hasKey() && !keyWaits.has(id))
          keyWaits.set(
            id,
            setTimeout(() => {
              keyWaits.delete(id)
              if (version === generation && !hasKey()) {
                error.value = 'crypto'
                void endCall()
              }
            }, 10000),
          )
        return
      }
      error.value = 'crypto'
      void endCall()
    })
    local.room.on(lk.RoomEvent.TrackSubscribed, (_track, publication) => {
      if (!publication.isEncrypted) {
        error.value = 'crypto'
        void endCall()
      } else refresh()
    })
    for (const event of [
      lk.RoomEvent.TrackUnsubscribed,
      lk.RoomEvent.ParticipantConnected,
      lk.RoomEvent.ParticipantDisconnected,
      lk.RoomEvent.LocalTrackPublished,
      lk.RoomEvent.LocalTrackUnpublished,
      lk.RoomEvent.TrackMuted,
      lk.RoomEvent.TrackUnmuted,
      lk.RoomEvent.AudioPlaybackStatusChanged,
      lk.RoomEvent.ParticipantEncryptionStatusChanged,
    ])
      local.room.on(event, refresh)
    local.room.on(lk.RoomEvent.Reconnecting, () => {
      if (version === generation) phase.value = 'reconnecting'
    })
    local.room.on(lk.RoomEvent.Reconnected, () => {
      if (version === generation) {
        phase.value = 'connected'
        refresh()
      }
    })
    local.room.on(lk.RoomEvent.Disconnected, () => {
      if (
        version === generation &&
        ['connected', 'reconnecting'].includes(phase.value)
      ) {
        error.value = 'unavailable'
        void endCall()
      }
    })
    rtc.join(
      {
        userId: current.getUserId()!,
        deviceId: current.getDeviceId()!,
        memberId: `${current.getUserId()}:${current.getDeviceId()}`,
      },
      [
        {
          type: 'livekit',
          livekit_service_url: location.origin + admission.focusPath,
        },
      ],
      {
        manageMediaKeys: true,
        callIntent: video ? 'video' : 'audio',
        notificationType: 'ring',
        notificationLifetimeMs: 30000,
        membershipEventExpiryMs: 30000,
        membershipEventExpiryHeadroomMs: 10000,
        keyRotationGracePeriodMs: 0,
        useKeyDelay: 500,
        maximumNetworkErrorRetryCount: 3,
        maximumRateLimitRetryCount: 3,
      },
    )
    // A restarted client can already have its legacy membership in room state.
    // Ask the SDK to recalculate even when the homeserver does not echo an identical state event.
    await rtc.ensureRecalculateSessionMembers()
    valid()
    await Promise.race([
      ownKey,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('rtc.crypto_key_timeout')), 15000),
      ),
    ])
    valid()
    const url = new URL(admission.sfuPath, location.origin)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    await local.room.connect(url.toString(), admission.jwt, {
      rtcConfig: { iceServers: [] },
    })
    valid()
    if (!local.room.localParticipant.isE2EEEnabled)
      throw new Error('rtc.crypto_after_connect')
    for (const track of local.capture) {
      await local.room.localParticipant.publishTrack(track)
      valid()
    }
    if (
      [...local.room.localParticipant.trackPublications.values()].some(
        (p) => !p.isEncrypted,
      )
    )
      throw new Error('rtc.crypto_plain_track')
    phase.value = 'connected'
    startedAt.value = Date.now()
    refresh()
    heartbeat = setInterval(() => {
      if (version !== generation) return
      if (!allowed(roomId)) {
        error.value = 'access'
        void endCall()
        return
      }
      void identityRequest(
        `/rtc/admissions/${admission.id}/check`,
        'POST',
      ).catch(() => {
        if (version === generation) {
          error.value = 'access'
          void endCall()
        }
      })
    }, 10000)
  } catch (failure) {
    if (version === generation) {
      error.value = classify(failure)
      await endCall()
    } else if (ownedMedia) {
      for (const track of ownedMedia.capture) track.stop()
      for (const publication of ownedMedia.room.localParticipant.trackPublications.values())
        publication.track?.stop()
      void ownedMedia.room.disconnect(true).catch(() => {})
      ownedMedia.worker.terminate()
    }
  }
}
export async function endCall() {
  generation++
  const previous = media,
    rtc = session,
    admission = ticket,
    detach = detached
  media = undefined
  session = undefined
  ticket = ''
  detached = undefined
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = undefined
  tracks.value = []
  people.value = []
  encrypted.value = false
  mic.value = false
  camera.value = false
  startedAt.value = 0
  callRoom.value = ''
  callName.value = ''
  audioBlocked.value = false
  for (const p of previous?.room.localParticipant.trackPublications.values() ??
    [])
    p.track?.stop()
  for (const track of previous?.capture ?? []) track.stop()
  detach?.()
  previous?.room.removeAllListeners()
  phase.value = 'ending'
  const cleanup = Promise.allSettled([
    previous?.room.disconnect(true),
    rtc?.leave(1000),
  ])
  // A slow/offline server must never hold the capture UI or encryption worker open.
  if (admission)
    void identityRequest(`/rtc/admissions/${admission}`, 'DELETE').catch(
      () => {},
    )
  previous?.worker.terminate()
  await Promise.race([
    cleanup,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ])
  if (!media) phase.value = 'idle'
}
export async function toggleMic() {
  try {
    if (media) {
      await media.room.localParticipant.setMicrophoneEnabled(!mic.value)
      refresh()
    }
  } catch (e) {
    error.value = classify(e)
  }
}
export async function toggleCamera() {
  try {
    if (media) {
      await media.room.localParticipant.setCameraEnabled(!camera.value)
      refresh()
    }
  } catch (e) {
    error.value = classify(e)
  }
}
export async function enableAudio() {
  try {
    await media?.room.startAudio()
    refresh()
  } catch {
    audioBlocked.value = true
  }
}
export function clearError() {
  error.value = undefined
}
