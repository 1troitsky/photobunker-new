/**
 * Signed ciphertext queue response policy. Never make a second crypto op to
 * "fix" an uncertain upload or interpret a generic 2xx as an acknowledgement.
 */
export function thumbnailShareOutcome(
  status:number|null,receipt:unknown,operationId:string,
):'ack'|'retry'|'conflict' {
  if(status===null)return 'retry'
  if(status>=200&&status<300){
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return 'retry'
    const r=receipt as Record<string,unknown>
    return r.accepted===true&&r.operationId===operationId?'ack':'retry'
  }
  if([400,403,404,409,410,422].includes(status))return 'conflict'
  return 'retry'
}
