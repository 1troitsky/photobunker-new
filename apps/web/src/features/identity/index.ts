/* Public capability boundary: UI modules never import raw crypto/IDB/HTTP SDKs. */
export { identity, prepareCreate, pendingCreate, finishCreate, discardPending,
  restore, loginWithDevice, logout, forgetRuntime, offlineUnlock, availableDevices,
  switchAccount, rotateRecoveryKey, beginPairing, finishPairing, pairingRequests,
  approvePairing, revokeDevice, backgroundSessionCheck, ensureBrowserSupport,
  onIdentityCleanup, hasPendingRotation } from './infrastructure/identity'
export { createPB2 } from './infrastructure/crypto'
export type { LocalDevice } from './infrastructure/storage'
export { default as IdentityPanel } from './ui/IdentityPanel.vue'

export { acquireStorageKeys, fetchAuthenticatedServerTime } from './infrastructure/identity'
