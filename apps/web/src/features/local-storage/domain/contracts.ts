/* R2-04 public value contracts. Indexed technical headers only; metadata opaque. */
export type AssetKind = 'master'|'original'|'edit'|'thumbnail'|'metadata'
export type Scope = Readonly<{ accountId:string; deviceId:string; generation:number }>
export type StorageBackend = 'opfs'|'idb-blob'
export type PhotoState = 'local'|'expired'|'delete_pending'
export type OutboxState = 'pending'|'retry'|'acknowledged'|'cancelled'|'conflict'
export type FrozenCapture=Readonly<{assignmentId:string;assignmentRevision:number;
  policyRevision:number;mode:2|3;retentionDays:number;capturedAt:number}>
export type ReviewDecision='pending'|'accepted'|'correction'|'reshoot'|'rejected'
export type ReviewEnvelope=Readonly<{v:1;accountId:string;photoId:string;operationId:string;
  revision:number;iv:string;wrappedDEK:WrappedDEK;ciphertext:string}>
export type ReviewContract=Readonly<{v:1;photoId:string;operationId:string;
  expectedRevision:number;action:'review'|'respond';state:Exclude<ReviewDecision,'pending'>|null;
  envelope:ReviewEnvelope}>
export type ReviewSnapshot=Readonly<{photoId:string;assignmentId:string;state:ReviewDecision;
  revision:number;reviewEnvelope:ReviewEnvelope|null;responseEnvelope:ReviewEnvelope|null}>
export type PhotoHeader = Readonly<{
  accountId:string; photoId:string; assetId:string; metadataAssetId:string
  expiresAt:number; state:PhotoState; revision:number; operationId:string
  thumbnailAssetId?:string;nameId?:string;namePending?:boolean;capture?:FrozenCapture;
  leaseId?:string;nameNumber?:number
  sourceAssetId?:string;editRevision?:number
  reviewState?:ReviewDecision;reviewRevision?:number
  reviewEnvelope?:ReviewEnvelope|null;responseEnvelope?:ReviewEnvelope|null
}>
export type WrappedDEK = Readonly<{iv:string;ciphertext:string}>
export type CipherFrame = Readonly<{index:number; offset:number; bytes:number; plainBytes:number; iv:string; digest:string}>
export type CipherManifest = Readonly<{
  version:1; algorithm:'AES-256-GCM'; chunkBytes:number; accountId:string; photoId:string; assetId:string
  kind:AssetKind; revision:number; expiresAt:number; plainBytes:number; cipherBytes:number; frames:CipherFrame[]
  cipherDigest:string; wrappedDEK:WrappedDEK; backend:StorageBackend; storageKey:string
}>
export type OutboxEntry = Readonly<{
  accountId:string; photoId:string; operationId:string; state:OutboxState
  intent:'upload'|'delete'|'metadata'|'review'|'edit'; attempts:number; nextAttemptAt:number; expiresAt:number
  lastError?:string; receiptHash?:string; metadataAssetId?:string; expectedRevision?:number;reviewContract?:ReviewContract;editAssetId?:string;editMode?:2|3
}>
export type CreatePhoto = Readonly<{
  operationId:string; photoId:string; assetId:string; metadataAssetId:string
  kind:Exclude<AssetKind,'metadata'>; revision:1
  capturedAt:number; expiresAt:number; pixels:Blob; metadata:unknown
  thumbnail?:Blob;thumbnailAssetId?:string
  nameId?:string;leaseId?:string;nameNumber?:number;capture?:FrozenCapture
}>
export type TimeStatus = Readonly<{
  trusted:boolean; now:number|null; reason:'fresh'|'restored'|'missing'|'reload'|'corrupt'|'wall_jump'|'monotonic_lost'
}>
export type PersistenceStatus = 'granted'|'denied'|'unsupported'|'error'
export type Capabilities = Readonly<{
  secureContext:boolean; indexedDB:boolean; structuredCloneKey:boolean
  opfs:boolean; fallbackBlob:boolean; backend:StorageBackend|null
  quota:number|null; usage:number|null
  persisted:PersistenceStatus; persistRequest:PersistenceStatus
  warning:string|null
}>
export interface PhotoRepository {
  commit(input:CreatePhoto):Promise<PhotoHeader>
  readHeader(photoId:string):Promise<PhotoHeader|null>
  readMetadata(photoId:string):Promise<unknown>
  list():Promise<PhotoHeader[]>
  confirmExpiry(photoId:string):Promise<void>
  reconcile():Promise<void>
}
export interface EncryptedBlobStore {
  read(photoId:string,assetId:string):Promise<Blob>
}
export type SyncAsset = Readonly<{
  assetId:string;kind:AssetKind;revision:number;bytes:number;sha256:string
  manifest:Omit<CipherManifest,'backend'|'storageKey'>;ciphertext:Blob
}>
export type SyncSnapshot = Readonly<{photoId:string;operationId:string;expiresAt:number;assets:SyncAsset[];capture?:FrozenCapture}>
export type SyncReceipt = Readonly<{photoId:string;operationId:string;expiresAt:number;
  assets:ReadonlyArray<Readonly<{assetId:string;kind:AssetKind;bytes:number;sha256:string}>>;receiptHash:string}>
export type SyncState = 'local'|'syncing'|'synced'|'retry'|'expired'
export interface PhotoSyncOutbox {
  pending():Promise<OutboxEntry[]>
  retry(operationId:string):Promise<void>
  delivery(operationId:string):Promise<SyncSnapshot>
  failDelivery(operationId:string,code:string):Promise<void>
  acknowledge(operationId:string,receipt:SyncReceipt):Promise<void>
  syncState(photoId:string):Promise<SyncState>
  revokeFromServer(photoId:string):Promise<void>
}
export interface TimeAuthority {
  restoreFromStorage():Promise<TimeStatus>
  refreshFromServer():Promise<TimeStatus>
  status():TimeStatus
  now():number
  proveExpiry(expiresAt:number):boolean
}

export type CloudAsset=Readonly<{assetId:string;kind:AssetKind;revision:number;
  bytes:number;sha256:string;manifest:Omit<CipherManifest,'backend'|'storageKey'>}>
export type CloudPhoto=Readonly<{photoId:string;expiresAt:number;metadataAssetId:string;
  metadataRevision:number;nameId:string|null;editRevision?:number;editAssetId?:string|null}>
