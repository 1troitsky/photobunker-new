import {identity} from '../../identity'
import {localGallery} from '../../gallery'
import {openAssignments} from '../../assignments'
import type {BrowserAssignment,BrowserPhoto} from '../domain/model'

export type BrowserSnapshot=Readonly<{photos:BrowserPhoto[];assignments:BrowserAssignment[]}>

/**
 * PB2-only local Browser. Reads through existing scoped vault and encrypted
 * Assignment repositories; no legacy Workspace, new outbox or implied Team grant.
 * Cloud-only and recipient photos require a later server-ACL-backed Browser API.
 */
export async function loadLocalBrowser():Promise<BrowserSnapshot>{
  const active=identity.value
  if(!active)throw Error('browser.locked')
  const {accountId,deviceId}=active
  const verify=()=>{
    if(identity.value?.accountId!==accountId||identity.value?.deviceId!==deviceId)
      throw Error('browser.identity_changed')
  }
  const photos=await localGallery()
  verify()
  const assignments=await openAssignments().list()
  verify()
  return{
    photos:photos.map(item=>({
      id:item.header.photoId,assignmentId:item.header.capture?.assignmentId??null,
      title:item.title,nameId:item.nameId,capturedAt:item.capturedAt,
      expiresAt:item.header.expiresAt,sync:item.state,
    })),
    assignments:assignments.map(item=>({id:item.id,title:item.title})),
  }
}
