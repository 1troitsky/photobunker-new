import {identity} from '../../identity'
import {openLocalPhotoVault} from '../../local-storage'
import {checkMetadata} from '../../gallery'
import {privateCard,type PrivateCard} from '../domain/card'

/** A private, owner-device-only PB2 card; no implicit public read or share capability. */
export async function loadPrivateCard(photoId:string):Promise<PrivateCard>{
  const active=identity.value
  if(!active)throw Error('photo_card.locked')
  const verify=()=>{
    if(identity.value?.accountId!==active.accountId||
      identity.value?.deviceId!==active.deviceId)throw Error('photo_card.identity_changed')
  }
  const vault=openLocalPhotoVault()
  const header=await vault.readHeader(photoId)
  verify()
  if(!header)throw Error('photo_card.unavailable')
  const metadata=checkMetadata(await vault.readMetadata(photoId))
  verify()
  const sync=await vault.syncState(photoId)
  verify()
  if(sync==='expired')throw Error('photo_card.unavailable')
  return privateCard(header,metadata,sync)
}
