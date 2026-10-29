import type { LocalDeleteJournal } from './local-delete-store'
export type DeleteTarget = { owner: string; device: string }
export type DeletePhases = {
  lock(): void
  signedOut(scope: DeleteTarget): void
  purge(scope: DeleteTarget): Promise<void>
  serverLogout(scope: DeleteTarget): Promise<void>
  advance(from: LocalDeleteJournal['phase'], to: LocalDeleteJournal['phase'], operationId: string): Promise<void>
  finish(operationId: string): Promise<void>
}
/** Pure phase driver for synthetic crash/reload tests.
 * The durable CAS stage/finish callbacks are the ONLY phase authority.
 */
export async function replayLocalDeletion(start: LocalDeleteJournal, ops: DeletePhases): Promise<void> {
  const scope={owner:start.accountId,device:start.deviceId}
  let phase=start.phase
  ops.lock()
  if(phase==='committed') {
    ops.signedOut(scope)
    await ops.advance('committed','signed-out',start.operationId)
    phase='signed-out'
  } else ops.signedOut(scope)
  if(phase==='signed-out') {
    await ops.purge(scope)
    await ops.advance('signed-out','local-purged',start.operationId)
    phase='local-purged'
  }
  if(phase==='local-purged') {
    await ops.serverLogout(scope)
    await ops.advance('local-purged','server-logout',start.operationId)
    phase='server-logout'
  }
  if(phase==='server-logout') await ops.finish(start.operationId)
}
