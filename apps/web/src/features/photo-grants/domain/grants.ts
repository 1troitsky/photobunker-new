export type SealedGrantSecret={v:1;iv:string;ciphertext:string}
export type GrantRole='curator'|'contributor'|'viewer'
export type GrantState='pending'|'accepted'|'declined'|'revoked'
export type GrantOperationKind='invite'|'accept'|'decline'|'revoke'|'leave'
export type GrantCommand={
  v:1;opId:string;kind:GrantOperationKind;grantId:string;assignmentId:string;
  targetId:string|null;role:GrantRole|null;expectedGeneration:number;
  expiresAt:number|null;codeHash:string|null;sealedKey:SealedGrantSecret|null
}
export type ServerGrant=Readonly<{
  grantId:string;assignmentId:string;ownerId:string;recipientId:string;
  role:GrantRole;state:GrantState;generation:number;inviteExpiresAt:number;
  codeHash:string|null;sealedKey:SealedGrantSecret|null
}>
export function command(kind:Exclude<GrantOperationKind,'invite'>,
  grant:ServerGrant):GrantCommand{
  return {v:1,opId:crypto.randomUUID(),kind,grantId:grant.grantId,
    assignmentId:grant.assignmentId,targetId:null,role:null,
    expectedGeneration:grant.generation,expiresAt:null,codeHash:null,sealedKey:null}
}
export function validateServerGrant(x:ServerGrant):ServerGrant{
  const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
  if(!x||!([x.grantId,x.assignmentId,x.ownerId,x.recipientId].every(v=>typeof v==='string'&&id.test(v)))||
    !['curator','contributor','viewer'].includes(x.role)||
    !['pending','accepted'].includes(x.state)||
    !Number.isSafeInteger(x.generation)||x.generation<1||
    !Number.isSafeInteger(x.inviteExpiresAt)||x.inviteExpiresAt<1)
    throw Error('grant.invalid_server_response')
  if(Object.keys(x).join('|')!=='grantId|assignmentId|ownerId|recipientId|role|state|generation|inviteExpiresAt|codeHash|sealedKey')
    throw Error('grant.invalid_server_response')
  if(x.codeHash===null){
    if(x.sealedKey!==null)throw Error('grant.invalid_server_response')
  }else{
    if(typeof x.codeHash!=='string'||!/^[a-f0-9]{64}$/.test(x.codeHash)||
      !x.sealedKey||x.sealedKey.v!==1||
      !/^[A-Za-z0-9_-]{16}$/.test(x.sealedKey.iv)||
      !/^[A-Za-z0-9_-]{64}$/.test(x.sealedKey.ciphertext))
      throw Error('grant.invalid_server_response')
  }
  return x
}
