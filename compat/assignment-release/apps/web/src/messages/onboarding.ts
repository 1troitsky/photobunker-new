import type { MatrixClient } from 'matrix-js-sdk'
import type { DeviceVerificationStatus } from 'matrix-js-sdk/lib/crypto-api'

export function canUseMessagingDevice(trust: Pick<DeviceVerificationStatus, 'signedByOwner' | 'crossSigningVerified'> | null): boolean {
  return trust?.signedByOwner === true && trust.crossSigningVerified === true
}

// Never replace an established identity just because this device lacks its keys.
// The SDK generates first-use keys; existing identities require recovery or SAS.
export async function initializeMessagingIdentity(
  client: MatrixClient,
  assertCurrent: () => void,
): Promise<boolean> {
  const crypto = client.getCrypto()!
  const published = await crypto.userHasCrossSigningKeys(undefined, true)
  assertCurrent()
  const status = await crypto.getCrossSigningStatus()
  assertCurrent()
  const local = status.privateKeysCachedLocally
  if (published)
    return local.masterKey && local.selfSigningKey && local.userSigningKey
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: (makeRequest) => makeRequest({}),
  })
  assertCurrent()
  return true
}
