import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {BrowserCamera} from './browser-camera'
function fixture(){
  const track={readyState:'live',stop:vi.fn(),getSettings:vi.fn(()=>({}))} as unknown as MediaStreamTrack
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]} as unknown as MediaStream
  const video={play:vi.fn(async()=>{}),pause:vi.fn(),srcObject:null,readyState:3,videoWidth:640,videoHeight:480} as unknown as HTMLVideoElement
  return{stream,track,video}
}
describe('R2-06 camera lifecycle',()=>{
  beforeEach(()=>{vi.stubGlobal('isSecureContext',true);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn()}})})
  afterEach(()=>vi.unstubAllGlobals())
  it('releases late permission result after navigation/cancel',async()=>{
    const f=fixture();let resolve!:(s:MediaStream)=>void
    const acquire=vi.fn(()=>new Promise<MediaStream>(ok=>{resolve=ok}))
    const camera=new BrowserCamera(f.video,acquire)
    const attempt=camera.start('environment')
    camera.stop()
    resolve(f.stream)
    await expect(attempt).rejects.toThrow('camera.cancelled')
    expect(f.track.stop).toHaveBeenCalledOnce()
    expect(camera.active).toBe(false)
  })
  it('releases tracks after video playback failure and explicit stop',async()=>{
    const f=fixture()
    vi.mocked(f.video.play).mockRejectedValueOnce(new Error('play failed'))
    const camera=new BrowserCamera(f.video,async()=>f.stream)
    await expect(camera.start('user')).rejects.toThrow('play failed')
    expect(f.track.stop).toHaveBeenCalledOnce()
    await camera.start('environment')
    camera.stop()
    expect(f.track.stop).toHaveBeenCalledTimes(2)
  })
  it('uses live frame fallback when ImageCapture unavailable',async()=>{
    const f=fixture();const canvas={
      width:0,height:0,getContext:()=>({drawImage:vi.fn()}),
      toBlob:(cb:(b:Blob)=>void)=>cb(new Blob(['jpeg'],{type:'image/jpeg'})),
    }
    vi.stubGlobal('window',{})
    vi.stubGlobal('document',{createElement:()=>canvas})
    const camera=new BrowserCamera(f.video,async()=>f.stream)
    await camera.start('environment')
    expect((await camera.take()).method).toBe('video-frame')
    camera.stop()
    expect(f.track.stop).toHaveBeenCalledOnce()
  })
  it('rejects late still result when camera stops mid-shot',async()=>{
    const f=fixture();let resolve!:(value:Blob)=>void
    vi.stubGlobal('window',{ImageCapture:class{takePhoto(){return new Promise<Blob>(ok=>resolve=ok)}}})
    const camera=new BrowserCamera(f.video,async()=>f.stream)
    await camera.start('environment')
    const capture=camera.take()
    camera.stop();resolve(new Blob(['image'],{type:'image/jpeg'}))
    await expect(capture).rejects.toThrow('camera.cancelled')
    expect(f.track.stop).toHaveBeenCalledOnce()
  })
})
