/** R2-06 capture policy v1: personal only. No assignment/remote binding. */
export type CaptureMode=1|2|3
export type Facing='environment'|'user'
export type Method='image-capture'|'video-frame'
export type CompressionProfile=Readonly<{version:1;mime:'image/jpeg';quality:0.90;maxEdge:4096;maxPixels:12_500_000}>
export const COMPRESSION_V1:CompressionProfile=Object.freeze({version:1,mime:'image/jpeg',quality:0.90,maxEdge:4096,maxPixels:12_500_000})
export const MIN_TTL_DAYS=1
export const MAX_TTL_DAYS=45
export const DEFAULT_TTL_DAYS=45
export type PersonalPolicy=Readonly<{policyVersion:1;source:'personal';assignmentId:null;mode:2|3;ttlDays:number}>
export type CaptureMetadata=Readonly<{
  policyVersion:1;policy:PersonalPolicy;mode:2|3;captureMethod:Method
  sourceWidth:number;sourceHeight:number;outputWidth:number;outputHeight:number
  capturedAt:number;expiresAt:number;mime:'image/jpeg';compression:CompressionProfile
}>
export function personalPolicy(mode:CaptureMode=3,ttlDays=45):PersonalPolicy{
  if(mode===1)throw new Error('camera.mode_unavailable')
  if(mode!==2&&mode!==3)throw new Error('camera.mode_invalid')
  if(!Number.isInteger(ttlDays)||ttlDays<MIN_TTL_DAYS||ttlDays>MAX_TTL_DAYS)throw new Error('camera.ttl_invalid')
  return Object.freeze({policyVersion:1,source:'personal',assignmentId:null,mode,ttlDays})
}
export function geometry(width:number,height:number):{width:number;height:number}{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('camera.invalid_dimensions')
  const factor=Math.min(1,COMPRESSION_V1.maxEdge/Math.max(width,height),
    Math.sqrt(COMPRESSION_V1.maxPixels/(width*height)))
  const w=Math.max(1,Math.floor(width*factor)),h=Math.max(1,Math.floor(height*factor))
  return {width:w,height:h}
}
export function snapshot(policy:PersonalPolicy,capturedAt:number,source:{width:number;height:number},
  output:{width:number;height:number},method:Method):CaptureMetadata{
  if(!Number.isSafeInteger(capturedAt)||capturedAt<=0)throw new Error('camera.untrusted_time')
  const expiresAt=capturedAt+policy.ttlDays*86_400_000
  if(!Number.isSafeInteger(expiresAt))throw new Error('camera.invalid_expiry')
  return Object.freeze({policyVersion:1,policy:Object.freeze({...policy}),mode:policy.mode,
    captureMethod:method,sourceWidth:source.width,sourceHeight:source.height,
    outputWidth:output.width,outputHeight:output.height,capturedAt,expiresAt,
    mime:'image/jpeg',compression:COMPRESSION_V1})
}
