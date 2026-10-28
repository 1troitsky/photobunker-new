/* Module public application boundary: UI/camera consume this file only. */
export { openLocalPhotoVault } from './infrastructure/vault'
export { probeStorageCapabilities } from './infrastructure/capabilities'
export type {
  AssetKind, Capabilities, CipherManifest, CreatePhoto, EncryptedBlobStore,
  OutboxEntry, PersistenceStatus, PhotoHeader, PhotoRepository, PhotoSyncOutbox,
  Scope, StorageBackend, TimeAuthority, TimeStatus,
  SyncAsset, SyncSnapshot, SyncReceipt, SyncState,
} from './domain/contracts'
export { default as StorageDiagnostics } from './ui/StorageDiagnostics.vue'
