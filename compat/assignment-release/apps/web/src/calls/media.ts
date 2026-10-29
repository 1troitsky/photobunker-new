import {
  type LocalTrack,
  BaseKeyProvider,
  Room,
  isE2EESupported,
  setLogLevel,
  LogLevel,
} from 'livekit-client'
import workerURL from 'livekit-client/e2ee-worker?worker&url'
// Matrix generates and distributes the keys. LiveKit supplies the media cipher/ratchet.
class MatrixKeyProvider extends BaseKeyProvider {
  constructor() {
    super({
      sharedKey: false,
      ratchetWindowSize: 0,
      failureTolerance: 10,
      keyringSize: 256,
    })
  }
  async add(raw: Uint8Array<ArrayBuffer>, participant: string, index: number) {
    const copy = new Uint8Array(raw)
    try {
      const key = await crypto.subtle.importKey('raw', copy, 'HKDF', false, [
        'deriveBits',
        'deriveKey',
      ])
      this.onSetEncryptionKey(key, participant, index)
    } finally {
      copy.fill(0)
    }
  }
}
export function createMedia() {
  if (!window.isSecureContext || !isE2EESupported())
    throw new Error('rtc.unsupported')
  setLogLevel(LogLevel.silent)
  const provider = new MatrixKeyProvider(),
    worker = new Worker(workerURL, { type: 'module' }),
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      encryption: { keyProvider: provider, worker },
      videoCaptureDefaults: {
        resolution: { width: 640, height: 480, frameRate: 20 },
      },
      publishDefaults: {
        videoCodec: 'vp8',
        dtx: false,
        red: false,
        simulcast: false,
      },
    })
  return { room, provider, worker, capture: [] as LocalTrack[] }
}
