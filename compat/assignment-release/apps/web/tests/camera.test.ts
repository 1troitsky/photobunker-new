// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraController } from '../src/local/camera'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function media(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  const stop = vi.fn()
  const track = {stop, getCapabilities:vi.fn(()=>({})),getSettings:vi.fn(()=>({})),applyConstraints:vi.fn(async()=>{})}
  const stream = { getTracks: () => [track], getVideoTracks:()=>[track] } as unknown as MediaStream
  const video = { srcObject: null, play: vi.fn(async () => undefined) } as unknown as HTMLVideoElement
  return { stop, stream, video, track }
}
describe('camera lifecycle', () => {
  it('stops a late permission result after leaving the camera', async () => {
    let grant!: (stream: MediaStream) => void
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve }))
    const { stream, stop, video } = media(getUserMedia)
    const controller = cameraController(video)
    expect(getUserMedia).not.toHaveBeenCalled()
    const pending = controller.start('environment')
    controller.stop(); grant(stream)
    await expect(pending).rejects.toThrow('cancelled')
    expect(stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
    expect(video.play).not.toHaveBeenCalled()
  })
  it('releases tracks if the preview cannot play', async () => {
    const getUserMedia = vi.fn()
    const { stream, stop, video } = media(getUserMedia)
    getUserMedia.mockResolvedValue(stream)
    vi.mocked(video.play).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    await expect(cameraController(video).start('user')).rejects.toThrow('Denied')
    expect(stop).toHaveBeenCalledOnce()
    expect(video.srcObject).toBeNull()
    expect(getUserMedia.mock.calls[0]![0].audio).toBe(false)
  })
  it('uses only advertised hardware controls and enables continuous focus', async () => {
    const getUserMedia = vi.fn()
    const { stream, video, track } = media(getUserMedia)
    getUserMedia.mockResolvedValue(stream)
    track.getCapabilities.mockReturnValue({ focusMode: ['continuous'], zoom: { min: 1, max: 4, step: 0.1 }, torch: true })
    track.getSettings.mockReturnValue({ width: 1920, height: 1080, zoom: 2, torch: false })
    const controller = cameraController(video)
    await controller.start('environment')
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] })
    expect(controller.features()).toMatchObject({ width: 1920, height: 1080, zoomValue: 2, torch: true })
    await controller.configure({ zoom: 3, torch: true })
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3, torch: true }] })
    await expect(controller.configure({ zoom: 5 })).rejects.toThrow('unsupported')
    await expect(controller.configure({ zoom: NaN })).rejects.toThrow('unsupported')
    controller.stop()
    await expect(controller.configure({ torch: true })).rejects.toThrow('not_ready')
  })
  it('hides unsupported controls and rejects a setting completed after stop', async () => {
    const getUserMedia = vi.fn()
    const { stream, video, track } = media(getUserMedia)
    getUserMedia.mockResolvedValue(stream)
    const controller = cameraController(video)
    await controller.start('user')
    expect(controller.features()).toMatchObject({ torch: false, zoom: undefined })
    await expect(controller.configure({ torch: true })).rejects.toThrow('unsupported')
    track.getCapabilities.mockReturnValue({ zoom: { min: 1, max: 3, step: 1 } })
    let finish!: () => void
    track.applyConstraints.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve}))
    const pending = controller.configure({ zoom: 2 })
    controller.stop(); finish()
    await expect(pending).rejects.toThrow('cancelled')
  })

})
