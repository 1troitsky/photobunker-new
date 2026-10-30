import {identity} from '../../identity'
import {fetchAssignmentGrants} from './grants'
import type {ServerGrant} from '../domain/grants'

/**
 * One client-side precondition for a received encrypted photo. The server's
 * live ACL on each request remains authoritative; this never grants access.
 */
export type RecipientScope=Readonly<{
  grant:ServerGrant;accountId:string;deviceId:string;check:()=>void
}>

export async function requireRecipientScope(grantId:string):Promise<RecipientScope>{
  const active=identity.value
  if(!active||active.offline||!navigator.onLine)throw Error('grant.offline')
  const {accountId,deviceId}=active
  const check=()=>{
    if(identity.value?.accountId!==accountId||
      identity.value?.deviceId!==deviceId||identity.value.offline)
      throw Error('grant.identity_changed')
  }
  const grants=await fetchAssignmentGrants()
  check()
  const grant=grants.find(row=>row.grantId===grantId&&
    row.recipientId===accountId&&row.state==='accepted')
  if(!grant)throw Error('grant.denied')
  return {grant,accountId,deviceId,check}
}

/** Refresh a recipient's current grant from the server without downloading a file. */
export async function recheckRecipientGrant(grantId:string):Promise<void>{
  const active=await requireRecipientScope(grantId)
  active.check()
}
