import type {PhotoHeader,SyncState} from '../../local-storage'
import type {PhotoMetadataV1,LocationFix} from '../../gallery'

export type PrivateCard=Readonly<{
  photoId:string;title:string|null;nameId:string|null;namePending:boolean;
  capturedAt:number;expiresAt:number;width:number;height:number;
  mime:'image/jpeg';mode:2|3;assignmentId:string|null;gps:LocationFix|null;sync:SyncState
}>
/** Pure projection of locally decrypted PB2 metadata, never a public/share card. */
export function privateCard(header:PhotoHeader,metadata:PhotoMetadataV1,sync:SyncState):PrivateCard{
  if(header.state!=='local'||metadata.capturedAt<=0||metadata.expiresAt!==header.expiresAt)
    throw Error('photo_card.metadata_conflict')
  const binding=header.capture
  if(binding){
    if(metadata.policy.source!=='assignment'||
      metadata.policy.assignmentId!==binding.assignmentId||
      metadata.policy.assignmentRevision!==binding.assignmentRevision||
      metadata.policy.policyRevision!==binding.policyRevision||
      metadata.mode!==binding.mode||metadata.policy.ttlDays!==binding.retentionDays||
      metadata.capturedAt!==binding.capturedAt)
      throw Error('photo_card.policy_conflict')
  }else if(metadata.policy.source!=='personal')throw Error('photo_card.policy_conflict')
  return{
    photoId:header.photoId,title:metadata.title?.trim()||null,
    nameId:header.nameId??null,namePending:header.namePending??false,
    capturedAt:metadata.capturedAt,expiresAt:metadata.expiresAt,
    width:metadata.outputWidth,height:metadata.outputHeight,mime:metadata.mime,
    mode:metadata.mode,assignmentId:binding?.assignmentId??null,
    gps:metadata.gps?.status==='ready'?metadata.gps:null,
    sync,
  }
}
