import {decryptAsset,manifestValid} from '../infrastructure/cipher'
import type {CipherManifest,Scope} from '../domain/contracts'

/**
 * The source photo's AES-GCM AAD is owner-scoped. NEVER substitute the
 * recipient's account ID or rewrite authenticated manifest fields.
 * Backend/path here are validation-only volatile adapters, never persisted.
 */
export async function decryptRecipientThumbnail(
  ownerAccountId:string,
  source:Omit<CipherManifest,'backend'|'storageKey'>,
  ciphertext:Blob,key:CryptoKey,stillCurrent:()=>void,
):Promise<Blob>{
  const manifest:CipherManifest={
    ...source,backend:'idb-blob',
    storageKey:[ownerAccountId,source.photoId,source.assetId,source.assetId].join('/'),
  }
  const scope:Scope={accountId:ownerAccountId,deviceId:'read-only-volatile',generation:0}
  stillCurrent()
  manifestValid(manifest,{scope,photoId:source.photoId,assetId:source.assetId})
  if(manifest.kind!=='thumbnail')throw Error('grant.asset_denied')
  const blob=await decryptAsset(manifest,ciphertext,key,scope,stillCurrent)
  stillCurrent()
  return new Blob([blob],{type:'image/webp'})
}
