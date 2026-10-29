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
class GrantsDB extends Dexie{
  secrets!:Table<SecretRow,string>
  operations!:Table<OperationRow,string>
  constructor(){
    super('photobunker-assignment-grants-v1')
    this.version(1).stores({
      secrets:'&id,[accountId+deviceId],grantId',
      operations:'&id,[accountId+deviceId],grantId,state,retryAt',
    })
  }
}
export const grantDb=new GrantsDB()
export function scopedId(account:string,device:string,id:string):string{
  return account+'/'+device+'/'+id
}
