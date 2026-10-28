import type { Challenge } from './crypto'
import { canonical, digest, hex, verifyChallenge } from './crypto'

let generation = 0
const controllers = new Set<AbortController>()
export class IdentityError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}
export function invalidateRequests(): void {
  generation++
  csrf=undefined
  for(const controller of controllers) controller.abort()
  controllers.clear()
}
export function currentGeneration(): number { return generation }
export function assertGeneration(epoch:number):void {
  if (epoch!==generation || document.visibilityState==='hidden') throw new DOMException('Identity changed','AbortError')
}
let csrf: string|undefined
async function token(epoch:number):Promise<string>{
  if(csrf)return csrf
  const controller=new AbortController()
  controllers.add(controller)
  try{
    const response=await fetch('/identity/v2/csrf',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
    if(!response.ok)throw new IdentityError('identity.csrf_failed',response.status)
    const body=await response.json() as {csrfToken:string}
    assertGeneration(epoch)
    if (typeof body.csrfToken!=='string') throw new IdentityError('identity.csrf_failed',400)
    csrf=body.csrfToken
    return csrf
  } finally{controllers.delete(controller)}
}
export async function call<T>(path:string,method:'GET'|'POST'|'DELETE'='GET',body?:unknown):Promise<T>{
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(path)) throw new IdentityError('identity.invalid_path',400)
  const epoch=currentGeneration()
  const controller=new AbortController()
  controllers.add(controller)
  try{
    const headers:Record<string,string>={'Accept':'application/json'}
    if(method!=='GET'){headers['Content-Type']='application/json';headers['X-CSRF-TOKEN']=await token(epoch)}
    assertGeneration(epoch)
    const response=await fetch('/identity/v2'+path,{
      method,credentials:'same-origin',cache:'no-store',signal:controller.signal,
      headers,body:body===undefined?undefined:JSON.stringify(body),
    })
    if(!response.ok)throw new IdentityError('identity.http_error',response.status)
    const value=await response.json() as T
    assertGeneration(epoch)
    return value
  }finally{controllers.delete(controller)}
}
export async function challenge(purpose:string,payload:Record<string,string>):Promise<Challenge>{
  const c=await call<Challenge>('/challenges','POST',{payload})
  await verifyChallenge(c,purpose,payload)
  return c
}
export async function envelopeHash(envelope:Record<string,unknown>):Promise<string>{
  return hex(await digest(new TextEncoder().encode(canonical(envelope))))
}
export function resetCsrf():void{csrf=undefined}
if(typeof window!=='undefined'){
  window.addEventListener('pagehide',()=>{invalidateRequests();csrf=undefined})
}
