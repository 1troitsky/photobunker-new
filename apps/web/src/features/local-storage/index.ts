/* Module public application boundary: UI/camera consume this file only. */
export { openLocalPhotoVault } from './infrastructure/vault'
export { probeStorageCapabilities } from './infrastructure/capabilities'
export type {
  AssetKind, Capabilities, CipherManifest, CreatePhoto, EncryptedBlobStore,
  OutboxEntry, PersistenceStatus, PhotoHeader, PhotoRepository, PhotoSyncOutbox,
  Scope, StorageBackend, TimeAuthority, TimeStatus,
  SyncAsset, SyncSnapshot, SyncReceipt, SyncState, CloudAsset, CloudPhoto,
  ReviewDecision,ReviewContract,ReviewEnvelope,ReviewSnapshot,
} from './domain/contracts'
export { default as StorageDiagnostics } from './ui/StorageDiagnostics.vue'

export {takeReservedName,reserveNameRange,claimName} from './infrastructure/names'
export {decryptRecipientThumbnail} from './infrastructure/recipient-thumbnail'

// Canonical asset cipher encoder for cross-feature interoperability and crypto vectors.
export {encryptAsset} from './infrastructure/cipher'

export {inspectPhotoStoreCounts} from './infrastructure/database'

export {scanLocalOwnership} from './infrastructure/ownership'
export type {LocalOwnershipInventory} from './infrastructure/ownership'
export {classifyLocalRecord,summarizeOwnership} from './domain/ownership'
export type {LocalOwnershipRow,OwnershipClassification,OwnershipSummary} from './domain/ownership'
