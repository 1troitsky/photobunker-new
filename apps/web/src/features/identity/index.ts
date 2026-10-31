/* Public capability boundary: UI modules never import raw crypto/IDB/HTTP SDKs. */
export { identity, prepareCreate, pendingCreate, finishCreate, discardPending,
  restore, loginWithDevice, logout, forgetRuntime, offlineUnlock, availableDevices,
  switchAccount, rotateRecoveryKey, beginPairing, finishPairing, pairingRequests,
  approvePairing, revokeDevice, backgroundSessionCheck, ensureBrowserSupport,
  onIdentityCleanup, registerDecryptedObjectUrl, revokeDecryptedObjectUrl, hasPendingRotation } from './infrastructure/identity'
export { createPB2 } from './infrastructure/crypto'
export type { LocalDevice } from './infrastructure/storage'
export { default as IdentityPanel } from './ui/IdentityPanel.vue'

export { acquireStorageKeys, fetchAuthenticatedServerTime } from './infrastructure/identity'

export { signPhotoSyncContract } from './infrastructure/identity'
export { photoRequest } from './infrastructure/api'

export {signMetadataContract} from './infrastructure/identity'

export {assignmentRequest} from './infrastructure/api'

export {collaborationRequest} from './infrastructure/api'

export {withCurrentOwnerAssetDEK} from './infrastructure/identity'
export {verifyOwnerThumbnailStatement} from './infrastructure/identity'

export {currentAccountSpki,signOwnerDeviceProof} from './infrastructure/identity'
export {verifyPinnedOwnerDeviceProof} from './infrastructure/identity'

export {accountDeviceRecords} from './infrastructure/identity'
export type {AccountDeviceRecord} from './infrastructure/identity'

/* PIN is enforced at Identity capabilities; UI never receives verifier or raw keys. */
export {appLockState,configureAppPin,lockApp,unlockAppPin} from './infrastructure/app-lock'
