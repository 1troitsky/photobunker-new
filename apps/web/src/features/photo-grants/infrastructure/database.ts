import Dexie,{type Table} from 'dexie'
import type {GrantCommand} from '../domain/grants'
import type {SealedLocalSecret} from './secret'
export type SecretRow={
  id:string;accountId:string;deviceId:string;grantId:string;assignmentId:string;
  ownerAccountId:string;recipientAccountId:string;envelope:SealedLocalSecret
}
export type OperationRow={
  id:string;accountId:string;deviceId:string;grantId:string;contract:GrantCommand;
  state:'pending'|'retry'|'conflict';attempts:number;retryAt:number;lastError:string|null
}
/** Durable ciphertext-only signed share submission; never stores raw DEK or grant code. */
export type ThumbnailShareRow=Readonly<{
  id:string;accountId:string;deviceId:string;grantId:string;photoId:string;
  assetId:string;generation:number;operationId:string;expiresAt:number;
  contract:string;signature:string;proof:{deviceId:string;deviceSpki:string;rootSignature:string};state:'pending'|'retry'|'conflict'|'acknowledged';
  retryAt:number;attempts:number;lastError:string|null
}>
class GrantsDB extends Dexie{
  secrets!:Table<SecretRow,string>
  operations!:Table<OperationRow,string>
  thumbnailShares!:Table<ThumbnailShareRow,string>
  constructor(){
    super('photobunker-assignment-grants-v1')
    this.version(1).stores({
      secrets:'&id,[accountId+deviceId],grantId',
      operations:'&id,[accountId+deviceId],grantId,state,retryAt',
    })
    this.version(2).stores({
      secrets:'&id,[accountId+deviceId],grantId',
      operations:'&id,[accountId+deviceId],grantId,state,retryAt',
      thumbnailShares:'&id,[accountId+deviceId],grantId,state,retryAt,expiresAt,&[accountId+deviceId+grantId+photoId+generation]',
    })
    // Dexie migration preserves v1/v2 data. The unique compound key also
    // prevents two concurrent tabs from creating different recipient DEKs
    // for the same grant generation and photo.
    this.version(3).stores({
      secrets:'&id,[accountId+deviceId],grantId',
      operations:'&id,[accountId+deviceId],grantId,state,retryAt',
      thumbnailShares:'&id,[accountId+deviceId],grantId,state,retryAt,expiresAt,&[accountId+deviceId+grantId+photoId+generation]',
    })
  }
}
export const grantDb=new GrantsDB()
export function scopedId(account:string,device:string,id:string):string{
  return account+'/'+device+'/'+id
}
