import {identity,photoRequest} from '../../identity'
import {openLocalPhotoVault,type ReviewDecision,type ReviewSnapshot} from '../../local-storage'
import {flushPhotoSync} from '../../photo-sync'
const denied=()=>{if(!identity.value)throw Error('review.account_locked')}
export type ReviewView=Awaited<ReturnType<ReturnType<typeof openLocalPhotoVault>['reviewDetails']>>
export async function listAssignmentPhotos(assignmentId:string){
  denied()
  const vault=openLocalPhotoVault()
  return (await vault.list()).filter(row=>row.capture?.assignmentId===assignmentId)
}
export async function loadReview(photoId:string):Promise<ReviewView>{
  denied()
  const current=identity.value!,vault=openLocalPhotoVault()
  if(!current.offline&&navigator.onLine){
    try{
      const response=await photoRequest('/'+photoId+'/review')
      if(response.status===410)throw Error('review.expired')
      if(response.ok){
        const remote=await response.json() as ReviewSnapshot
        if(identity.value?.accountId!==current.accountId||
          identity.value.deviceId!==current.deviceId)throw Error('review.account_changed')
        await vault.ingestReview(remote)
      }
    }catch(e){
      if(e instanceof Error&&(e.message==='review.expired'||e.message==='review.account_changed'))throw e
      // Offline cached encrypted review stays usable; never claim remote confirmation.
    }
  }
  return vault.reviewDetails(photoId)
}
export async function submitReview(photoId:string,action:'review'|'respond',
  state:Exclude<ReviewDecision,'pending'>|null,comment:string):Promise<ReviewView>{
  denied()
  const vault=openLocalPhotoVault()
  await vault.queueReview(photoId,action,state,comment)
  if(!identity.value?.offline&&navigator.onLine)void flushPhotoSync()
  return vault.reviewDetails(photoId)
}
export async function acceptServerReview(photoId:string):Promise<ReviewView>{
  denied()
  if(identity.value!.offline)throw Error('review.requires_online')
  const response=await photoRequest('/'+photoId+'/review')
  if(!response.ok)throw Error('review.http_'+response.status)
  const remote=await response.json() as ReviewSnapshot
  const vault=openLocalPhotoVault()
  await vault.acceptReviewConflict(remote)
  return vault.reviewDetails(photoId)
}
