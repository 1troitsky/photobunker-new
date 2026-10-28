/* R2-04 public value contracts. Indexed technical headers only; metadata opaque. */
export type AssetKind = 'master'|'original'|'edit'|'thumbnail'|'metadata'
export type Scope = Readonly<{ accountId:string; deviceId:string; generation:number }>
export type StorageBackend = 'opfs'|'idb-blob'
export type PhotoState = 'local'|'expired'|'delete_pending'
export type OutboxState = 'pending'|'retry'|'acknowledged'|'cancelled'
export type PhotoHeader = Readonly<{
  accountId:string; photoId:string; assetId:string; metadataAssetId:string
  expiresAt:number; state:PhotoState; revision:number; operationId:string
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
  intent:'upload'|'delete'; attempts:number; nextAttemptAt:number; expiresAt:number
  lastError?:string; receiptHash?:string
}>
export type CreatePhoto = Readonly<{
  operationId:string; photoId:string; assetId:string; metadataAssetId:string
  kind:Exclude<AssetKind,'metadata'>; revision:1
  capturedAt:number; expiresAt:number; pixels:Blob; metadata:unknown
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
export type SyncSnapshot = Readonly<{photoId:string;operationId:string;expiresAt:number;assets:SyncAsset[]}>
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
