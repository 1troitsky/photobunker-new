// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
const fake = vi.hoisted(() => ({
  request: vi.fn(),
  create: vi.fn(),
  createTracks: vi.fn(),
}))
vi.mock('../src/identity/api', () => ({
  identityRequest: fake.request,
  IdentityError: class extends Error {},
}))
vi.mock('../src/identity/store', async () => ({
  account: (await import('vue')).ref({ id: 'synthetic' }),
}))
vi.mock('../src/calls/media', () => ({ createMedia: fake.create }))
vi.mock('matrix-js-sdk/lib/matrixrtc', () => ({
  MatrixRTCSessionEvent: {
    EncryptionKeyChanged: 'key',
    MembershipManagerError: 'error',
  },
}))
vi.mock('livekit-client', () => ({
  createLocalTracks: fake.createTracks,
  CryptorErrorReason: { MissingKey: 1, InvalidKey: 0 },
  RoomEvent: Object.fromEntries(
    [
      'EncryptionError',
      'TrackSubscribed',
      'TrackUnsubscribed',
      'ParticipantConnected',
      'ParticipantDisconnected',
      'LocalTrackPublished',
      'LocalTrackUnpublished',
      'TrackMuted',
      'TrackUnmuted',
      'AudioPlaybackStatusChanged',
      'ParticipantEncryptionStatusChanged',
      'Reconnecting',
      'Reconnected',
      'Disconnected',
    ].map((name) => [name, name]),
  ),
}))
import { EventEmitter } from 'node:events'
import {
  bindCalls,
  enabled,
  joinCall,
  endCall,
  phase,
  tracks,
} from '../src/calls/store'
let media: any, rtc: any
beforeEach(async () => {
  const track = { stop: vi.fn() }
  const participant = {
    identity: 'synthetic:device',
    isE2EEEnabled: true,
    isMicrophoneEnabled: true,
    trackPublications: new Map([['audio', { track, isEncrypted: true }]]),
    setMicrophoneEnabled: vi.fn(async () => {}),
    setCameraEnabled: vi.fn(async () => {}),
    publishTrack: vi.fn(async () => {}),
  }
  media = {
    provider: {
      add: vi.fn(async () => {}),
      getKeys: () => [{ participantIdentity: 'synthetic:device' }],
    },
    worker: { terminate: vi.fn() },
    capture: [],
    room: Object.assign(new EventEmitter().setMaxListeners(20), {
      localParticipant: participant,
      remoteParticipants: new Map(),
      isE2EEEnabled: true,
      canPlaybackAudio: true,
      setE2EEEnabled: vi.fn(async () => {}),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    }),
  }
  rtc = Object.assign(new EventEmitter(), {
    memberships: [],
    initialMembershipCalculated: Promise.resolve(),
    ensureRecalculateSessionMembers: vi.fn(async () => {
      rtc.emit('key', new Uint8Array(32), 0, {}, 'synthetic:device')
    }),
    join: vi.fn(),
    leave: vi.fn(async () => {}),
  })
  fake.request.mockReset().mockImplementation(async (path: string) =>
    path === '/rtc/config'
      ? { enabled: true }
      : path === '/rtc/join'
        ? {
            id: 'ticket',
            participant: 'synthetic:device',
            jwt: 'synthetic',
            sfuPath: '/rtc/sfu',
            focusPath: '/api/v1/identity/rtc',
          }
        : {},
  )
  fake.create.mockReturnValue(media)
  fake.createTracks.mockReset().mockResolvedValue([track])
  bindCalls(
    {
      getRoom: () => ({ name: 'Synthetic room' }),
      getRooms: () => [],
      matrixRTC: { getRoomSession: () => rtc },
      getUserId: () => 'synthetic',
      getDeviceId: () => 'device',
    } as never,
    () => true,
  )
  await flushPromises()
  enabled.value = true
})
afterEach(async () => {
  bindCalls(undefined)
  await endCall()
  vi.useRealTimers()
})
it('stops capture and destroys keys immediately even when leave requests never settle', async () => {
  await joinCall('!synthetic')
  expect(phase.value).toBe('connected')
  media.room.disconnect.mockReturnValue(new Promise(() => {}))
  rtc.leave.mockReturnValue(new Promise(() => {}))
  fake.request.mockReturnValue(new Promise(() => {}))
  vi.useFakeTimers()
  const ending = endCall()
  expect(
    media.room.localParticipant.trackPublications.get('audio').track.stop,
  ).toHaveBeenCalled()
  expect(media.worker.terminate).toHaveBeenCalled()
  expect(tracks.value).toEqual([])
  await vi.advanceTimersByTimeAsync(1500)
  await ending
  expect(phase.value).toBe('idle')
})
it('cleans up an admission that arrives after the user cancels without connecting or publishing', async () => {
  let release!: (value: unknown) => void
  fake.request.mockImplementation((path: string) =>
    path === '/rtc/join'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve({}),
  )
  const joining = joinCall('!synthetic')
  await flushPromises()
  await endCall()
  release({ id: 'late-ticket', participant: 'synthetic:device' })
  await joining
  expect(media.room.connect).not.toHaveBeenCalled()
  expect(
    media.room.localParticipant.setMicrophoneEnabled,
  ).not.toHaveBeenCalled()
  expect(fake.request).toHaveBeenCalledWith(
    '/rtc/admissions/late-ticket',
    'DELETE',
    undefined,
    'synthetic',
  )
  expect(media.worker.terminate).toHaveBeenCalled()
  expect(phase.value).toBe('idle')
})

it('drops missing-key media while waiting for remote key delivery and closes on timeout', async () => {
  await joinCall('!synthetic')
  vi.useFakeTimers()
  media.room.emit(
    'EncryptionError',
    { message: 'MissingKey: synthetic-worker-error' },
    { identity: 'remote:device' },
  )
  expect(phase.value).toBe('connected')
  await vi.advanceTimersByTimeAsync(10000)
  expect(media.worker.terminate).toHaveBeenCalled()
  await flushPromises()
  expect(phase.value).toBe('idle')
})
it('refuses unsupported encryption before requesting admission or starting capture', async () => {
  fake.create.mockImplementationOnce(() => {
    throw new Error('rtc.unsupported')
  })
  await joinCall('!synthetic')
  expect(fake.request.mock.calls.some(([path]) => path === '/rtc/join')).toBe(
    false,
  )
  expect(
    media.room.localParticipant.setMicrophoneEnabled,
  ).not.toHaveBeenCalled()
  expect(phase.value).toBe('idle')
})
it('handles denied capture before issuing a short-lived admission', async () => {
  fake.createTracks.mockRejectedValueOnce(
    new DOMException('Synthetic', 'NotAllowedError'),
  )
  await joinCall('!synthetic')
  expect(fake.request.mock.calls.some(([path]) => path === '/rtc/join')).toBe(
    false,
  )
  expect(media.room.localParticipant.publishTrack).not.toHaveBeenCalled()
  expect(media.worker.terminate).toHaveBeenCalled()
  expect(phase.value).toBe('idle')
})
it('stops a capture returned after cancellation without connecting or issuing admission', async () => {
  let release!: (tracks: unknown[]) => void
  const lateTrack = { stop: vi.fn() }
  fake.createTracks.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    }),
  )
  const joining = joinCall('!synthetic')
  await flushPromises()
  await endCall()
  release([lateTrack])
  await joining
  expect(lateTrack.stop).toHaveBeenCalled()
  expect(fake.request.mock.calls.some(([path]) => path === '/rtc/join')).toBe(
    false,
  )
  expect(media.room.localParticipant.publishTrack).not.toHaveBeenCalled()
})
