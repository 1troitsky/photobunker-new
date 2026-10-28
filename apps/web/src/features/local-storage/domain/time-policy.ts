/* Only live performance.now() continuity can advance server-authoritative time.
   Wall time is diagnostic only, never an independent expiry/deletion proof. */
export const MAX_CLOCK_SKEW_MS=300_000
export type ClockEval = {trusted:boolean; now:number|null; cause:'ok'|'monotonic_lost'|'wall_jump'}
export function liveTime(serverUtc:number,monotonicStart:number,wallStart:number,monotonicNow:number,wallNow:number):ClockEval{
  const inputs=[serverUtc,monotonicStart,wallStart,monotonicNow,wallNow]
  if(inputs.some(x=>!Number.isFinite(x)) || serverUtc<=0)return {trusted:false,now:null,cause:'monotonic_lost'}
  const elapsed=monotonicNow-monotonicStart
  if(elapsed<0)return{trusted:false,now:null,cause:'monotonic_lost'}
  if(Math.abs(wallNow-wallStart-elapsed)>MAX_CLOCK_SKEW_MS)
    return{trusted:false,now:null,cause:'wall_jump'}
  return{trusted:true,now:Math.floor(serverUtc+elapsed),cause:'ok'}
}
export function retentionValid(capturedAt:number,expiresAt:number):boolean {
  const ttl=expiresAt-capturedAt
  return Number.isSafeInteger(capturedAt)&&Number.isSafeInteger(expiresAt)
    && ttl>=86_400_000&&ttl<=45*86_400_000
}
