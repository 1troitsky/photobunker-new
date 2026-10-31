import Dexie,{type Table} from 'dexie'
import type {AssignmentContract,AssignmentEnvelope} from './crypto'
import type {AssignmentStatus} from '../domain/model'
export type Row={key:string;accountId:string;assignmentId:string;status:AssignmentStatus;
  revision:number;policyRevision:number;mode:2|3;retentionDays:number;
  envelope:AssignmentEnvelope;createdAt:string|null;updatedAt:string|null;
  deleted:boolean;conflict:boolean}
export type Operation={key:string;accountId:string;assignmentId:string;operationId:string;
  contract:AssignmentContract;state:'pending'|'retry'|'acknowledged'|'conflict'|'discarded';
  attempts:number;nextAttemptAt:number;error?:string}
export type Tombstone={key:string;accountId:string;assignmentId:string}
class AssignmentDatabase extends Dexie{
  assignments!:Table<Row,string>
  operations!:Table<Operation,string>
  tombstones!:Table<Tombstone,string>
  constructor(){
    super('photobunker-assignments-encrypted-v1')
    this.version(1).stores({
      assignments:'&key,accountId,[accountId+deleted],[accountId+status]',
      operations:'&key,accountId,[accountId+assignmentId],[accountId+state],&operationId',
      tombstones:'&key,accountId',
    })
  }
}
export const assignmentDb=new AssignmentDatabase()
export const assignmentKey=(account:string,id:string)=>account+'/'+id
export const operationKey=(account:string,id:string)=>account+'/'+id

export async function inspectAssignmentPending(account:string):Promise<number>{
  const rows=await assignmentDb.operations.where('accountId').equals(account).toArray()
  return rows.filter(row=>!['acknowledged','discarded'].includes(row.state)).length
}
