/** R2-06 only. Public feature API; no UI imports raw media/storage/crypto SDKs. */
import {createCaptureSession} from './application/capture'
import {compressCapture} from './infrastructure/compression'
export {BrowserCamera,captureError} from './infrastructure/browser-camera'
export {personalPolicy,geometry,COMPRESSION_V1,MIN_TTL_DAYS,MAX_TTL_DAYS,DEFAULT_TTL_DAYS,snapshot} from './domain/policy'
export type {CaptureMode,Facing,Method,CaptureMetadata,PersonalPolicy} from './domain/policy'
export type {CaptureSession,CaptureProgress} from './application/capture'
export {openLocalPhotos} from './application/capture'
export function openCaptureSession(){return createCaptureSession(compressCapture)}
export {default as CameraScreen} from './ui/CameraScreen.vue'
export {default as LocalPhotosScreen} from './ui/LocalPhotosScreen.vue'
export {default as LocalPhotoViewer} from './ui/LocalPhotoViewer.vue'
