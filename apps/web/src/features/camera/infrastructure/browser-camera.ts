import type {Facing,Method} from '../domain/policy'
export type PhotoSource=Readonly<{blob:Blob;method:Method}>
type ImageCaptureApi=new(track:MediaStreamTrack)=>{takePhoto():Promise<Blob>}
function stopped(stream:MediaStream){stream.getTracks().forEach(track=>track.stop())}
/** Pure lifecycle adapter. No demo capture, no save-to-Photos or input[type=file]. */
export class BrowserCamera{
  private stream:MediaStream|null=null
  private generation=0
  constructor(private readonly video:HTMLVideoElement,private readonly acquire:
    (options:MediaStreamConstraints)=>Promise<MediaStream>=(c)=>navigator.mediaDevices.getUserMedia(c)){}
  get active(){return this.stream?.getVideoTracks().some(x=>x.readyState==='live')??false}
  stop():void{
    this.generation++
    if(this.stream){stopped(this.stream);this.stream=null}
    this.video.pause()
    this.video.srcObject=null
  }
  async start(facing:Facing):Promise<void>{
    this.stop()
    const token=this.generation
    if(!isSecureContext || !navigator.mediaDevices?.getUserMedia)throw new Error('camera.insecure_or_unsupported')
    let stream:MediaStream
    try{
      stream=await this.acquire({audio:false,video:{facingMode:{ideal:facing},
        width:{ideal:1920},height:{ideal:1080}}})
    }catch(e){if(token!==this.generation)throw new Error('camera.cancelled');throw e}
    if(token!==this.generation){stopped(stream);throw new Error('camera.cancelled')}
    const track=stream.getVideoTracks()[0]
    if(!track || track.readyState!=='live'){stopped(stream);throw new Error('camera.no_track')}
    this.stream=stream
    this.video.srcObject=stream
    try{
      await this.video.play()
      if(token!==this.generation)throw new Error('camera.cancelled')
    }catch(e){
      stopped(stream)
      if(this.stream===stream){this.stream=null;this.video.srcObject=null}
      throw e
    }
  }
  /** Captures a true camera still; unsupported ImageCapture falls back to live video frame. */
  async take():Promise<PhotoSource>{
    const token=this.generation,stream=this.stream,track=stream?.getVideoTracks()[0]
    if(!track || track.readyState!=='live')throw new Error('camera.not_ready')
    const api=(window as Window&{ImageCapture?:ImageCaptureApi}).ImageCapture
    if(api){
      try{
        const still=new api(track)
        const blob=await still.takePhoto()
        if(token!==this.generation)throw new Error('camera.cancelled')
        if(blob.size>0)return{blob,method:'image-capture'}
      }catch(e){
        if(token!==this.generation)throw new Error('camera.cancelled')
        // Some browsers implement ImageCapture but reject it for video tracks.
        if(e instanceof DOMException && e.name==='NotAllowedError')throw e
      }
    }
    if(token!==this.generation)throw new Error('camera.cancelled')
    if(this.video.readyState<2 || this.video.videoWidth<1 || this.video.videoHeight<1)
      throw new Error('camera.frame_unavailable')
    const canvas=document.createElement('canvas')
    canvas.width=this.video.videoWidth;canvas.height=this.video.videoHeight
    try{
      const ctx=canvas.getContext('2d')
      if(!ctx)throw new Error('camera.canvas_unavailable')
      ctx.drawImage(this.video,0,0,canvas.width,canvas.height)
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('camera.frame_encode_failed')),'image/jpeg',.94))
      if(token!==this.generation)throw new Error('camera.cancelled')
      return{blob,method:'video-frame'}
    }finally{canvas.width=0;canvas.height=0}
  }
}
export function captureError(error:unknown):string{
  if(error instanceof DOMException){
    if(error.name==='NotAllowedError'||error.name==='PermissionDeniedError')return 'camera.permission_denied'
    if(error.name==='NotFoundError'||error.name==='DevicesNotFoundError')return 'camera.no_device'
    if(error.name==='NotReadableError'||error.name==='TrackStartError')return 'camera.device_busy'
    if(error.name==='QuotaExceededError')return 'storage.quota_exceeded'
    if(error.name==='AbortError')return 'camera.cancelled'
  }
  return error instanceof Error?error.message:'camera.capture_failed'
}
