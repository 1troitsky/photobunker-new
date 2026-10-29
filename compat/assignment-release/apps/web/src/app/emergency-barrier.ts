/** Synchronous in-memory barrier: lets Identity reject stale async session
 * responses BEFORE they can restore A after the destructive intent commits.
 * This module deliberately imports no stores (avoids a bootstrap cycle).
 */
// Startup itself is serialized by main.ts before Identity is allowed to run.
// The in-memory barrier becomes active synchronously once a command is found
// or committed, and then rejects callbacks that were already in flight.
let active=false
export const emergencyBarrierActive=()=>active
export const beginEmergencyBarrier=()=>{active=true}
export const resetEmergencyBarrierForNormalBootstrap=()=>{active=false}
