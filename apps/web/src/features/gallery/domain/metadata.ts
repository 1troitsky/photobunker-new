import type {CaptureMetadata} from '../../camera'
export type LocationFix={source:'gps';latitude:number;longitude:number;accuracy:number;measuredAt:number;status:'ready'}
export type PhotoMetadataV1=CaptureMetadata & {schemaVersion?:1;title?:string;gps?:LocationFix|null;gpsStatus?:'pending'|'unavailable'|'denied'|'disabled'|'ready'}
export function checkMetadata(value:unknown):PhotoMetadataV1{
  if(!value||typeof value!=='object')throw Error('gallery.metadata_invalid')
  const v=value as Record<string,unknown>
  if(v.policyVersion!==1||v.mode!==2&&v.mode!==3||!Number.isSafeInteger(v.capturedAt)||
      !Number.isSafeInteger(v.expiresAt)||!Number.isSafeInteger(v.outputWidth)||
      !Number.isSafeInteger(v.outputHeight)||v.mime!=='image/jpeg')
    throw Error('gallery.metadata_invalid')
  const allowed=['policyVersion','policy','mode','captureMethod','sourceWidth','sourceHeight',
    'outputWidth','outputHeight','capturedAt','expiresAt','mime','compression','schemaVersion','title','gps','gpsStatus']
  if(Object.keys(v).some(key=>!allowed.includes(key))||v.schemaVersion!==undefined&&v.schemaVersion!==1)
    throw Error('gallery.metadata_fields')
  if(!['image-capture','video-frame'].includes(v.captureMethod as string))throw Error('gallery.capture_method')
  for(const field of ['sourceWidth','sourceHeight','outputWidth','outputHeight']){
    const n=v[field];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>100000)
      throw Error('gallery.dimensions_invalid')
  }
  const policy=v.policy as Record<string,unknown>|undefined
  if(!policy||policy.policyVersion!==1||policy.source!=='personal'||policy.assignmentId!==null||
    policy.mode!==v.mode||!Number.isInteger(policy.ttlDays))
    throw Error('gallery.policy_invalid')
  if((policy.ttlDays as number)>45||(policy.ttlDays as number)<1||
    (v.expiresAt as number)-(v.capturedAt as number)!==(policy.ttlDays as number)*86400000)
    throw Error('gallery.expiry_invalid')
  const compression=v.compression as Record<string,unknown>|undefined
  if(!compression||compression.version!==1||compression.mime!=='image/jpeg'||
    compression.quality!==0.90||compression.maxEdge!==4096||compression.maxPixels!==12500000)
    throw Error('gallery.compression_invalid')
  if(v.title!==undefined&&(typeof v.title!=='string'||v.title.length>160||
    [...v.title].some(character=>character.charCodeAt(0)<32)))
    throw Error('gallery.title_invalid')
  if(v.gps!==undefined&&v.gps!==null)checkFix(v.gps)
  if(v.gpsStatus!==undefined&&!['pending','unavailable','denied','disabled','ready'].includes(v.gpsStatus as string))
    throw Error('gallery.gps_invalid')
  return value as PhotoMetadataV1
}
export function checkFix(value:unknown):LocationFix{
  if(!value||typeof value!=='object')throw Error('gallery.gps_invalid')
  const f=value as Record<string,unknown>
  if(f.source!=='gps'||f.status!=='ready'||![f.latitude,f.longitude,f.accuracy,f.measuredAt].every(x=>typeof x==='number'&&Number.isFinite(x))
   ||Math.abs(f.latitude as number)>90||Math.abs(f.longitude as number)>180
   ||(f.accuracy as number)<=0||(f.accuracy as number)>5000||(f.measuredAt as number)<=0)
    throw Error('gallery.gps_invalid')
  return value as LocationFix
}
export const namePattern=/^[A-Z]{4}[0-9]{4}$/
export function formatName(prefix:string,number:number):string{
  if(!/^[A-Z]{4}$/.test(prefix)||!Number.isInteger(number)||number<1||number>9999)
    throw Error('gallery.name_invalid')
  return prefix+String(number).padStart(4,'0')
}
