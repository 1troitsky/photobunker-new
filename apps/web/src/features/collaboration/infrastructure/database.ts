import Dexie,{type Table} from 'dexie'
import type {CollaborationContract,TeamCipher,TeamMember} from '../domain/model'
import type {KeyVault,EncryptedSnapshot} from './crypto'
export type CachedTeam={key:string;accountId:string;teamId:string;ownerId:string;role:'owner'|'curator'|'contributor'|'viewer';
  revision:number;profile:TeamCipher;members:TeamMember[];updatedAt:string|null;
  deleted:boolean;sync:'local'|'retry'|'conflict'|'synced'}
export type PendingOperation={key:string;accountId:string;opId:string;
  contract:CollaborationContract;state:'pending'|'retry'|'acknowledged'|'conflict';
  attempts:number;nextAttemptAt:number;error?:string;sequence:number}
export type StoredKey=KeyVault&{key:string}
export type StoredSnapshot=EncryptedSnapshot&{accountId:string}
class CollaborationDatabase extends Dexie{
  teams!:Table<CachedTeam,string>
  keys!:Table<StoredKey,string>
  operations!:Table<PendingOperation,string>
  snapshots!:Table<StoredSnapshot,string>
  constructor(){
    super('photobunker-collaboration-encrypted-v1')
    this.version(1).stores({
      teams:'&key,accountId,[accountId+teamId]',
      keys:'&key,accountId',
      operations:'&key,accountId,[accountId+state]',
      snapshots:'&accountId',
    })
  }
}
export const collaborationDb=new CollaborationDatabase()
export const k=(account:string,id:string)=>account+'/'+id

export async function inspectCollaborationPending(account:string):Promise<number>{
  const rows=await collaborationDb.operations.where('accountId').equals(account).toArray()
  return rows.filter(row=>row.state!=='acknowledged').length
}
