import {photoRequest} from '../../identity'
import {requireRecipientScope} from './recipient-scope'

export type RecipientThumbnailRef=Readonly<{photoId:string;assetId:string;expiresAt:number}>
export type RecipientThumbnailPage=Readonly<{
  photos:RecipientThumbnailRef[];nextCursor:string|null
}>
const cursorPattern=/^[A-Za-z0-9_-]{40,768}$/
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export function validateThumbnailPage(
  value:unknown,previousCursor:string|null,now:number,
):RecipientThumbnailPage{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('grant.invalid_photo_list')
  const data=value as Partial<RecipientThumbnailPage>
  const cursor=data.nextCursor
  if(!Array.isArray(data.photos)||data.photos.length>50||
    !(cursor===null||typeof cursor==='string'&&cursorPattern.test(cursor))||
    (previousCursor!==null&&cursor===previousCursor))
    throw Error('grant.invalid_photo_list')
  // Cursor is encrypted opaque state, not a photo ID. Only order the current page.
  let last=''
  const photos:RecipientThumbnailRef[]=[]
  for(const item of data.photos){
    if(!item||!uuid.test(item.photoId)||!uuid.test(item.assetId)||
      item.photoId<=last||!Number.isSafeInteger(item.expiresAt)||item.expiresAt<=now)
      throw Error('grant.invalid_photo_list')
    last=item.photoId;photos.push(item)
  }
  return {photos,nextCursor:cursor}
}
/** Owner's approved thumbnail IDs only. No raw file data or shared originals. */
export async function listRecipientThumbnails(
  grantId:string,after:string|null=null,
):Promise<RecipientThumbnailPage>{
  if(!uuid.test(grantId)||after!==null&&!cursorPattern.test(after))
    throw Error('grant.invalid_scope')
  const scope=await requireRecipientScope(grantId)
  const route='/shared/grants/'+grantId+'/photos'+
    (after?'?after='+after+'&limit=30':'')
  const response=await photoRequest(route)
  scope.check()
  if(!response.ok)throw Error('grant.photo_list_http_'+response.status)
  const data=await response.json() as unknown
  scope.check()
  return validateThumbnailPage(data,after,Date.now())
}
