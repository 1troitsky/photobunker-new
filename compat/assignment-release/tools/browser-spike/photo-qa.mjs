import {expect} from '@playwright/test'
import {origin,button,label} from './account-qa.mjs'
async function advanced(page){await expect(page.locator('details')).toBeVisible();if(!await page.locator('details').first().evaluate(el=>el.open))await page.locator('details summary').first().click()}
export async function enrollPhotos(f){
 await f.page.goto(`${origin}/profile/photos-security`)
 if(!f.photoKit)f.photoKit=await f.page.evaluate(async kit=>{const s=await import('/src/crypto/store.ts');await s.loadProtection();await s.beginSetup(kit);const key=s.candidateKit.value;await s.confirmSetup();return key},f.kit)
 await advanced(f.page)
}
export async function unlockPhotos(f,assignment){
 await f.page.goto(`${origin}/profile/photos-security${assignment?'?assignment='+assignment:''}`)
 await f.page.evaluate(async kit=>{const s=await import('/src/crypto/store.ts');await s.loadProtection();if(!s.strongUnlocked.value)await s.unlock(kit)},f.photoKit)
 await advanced(f.page)
}

// Legacy protocol drills prepare explicit assignment plans; normal camera QA does
// not invoke this helper and must prepare itself from its public user interface.
export async function preparePhotos(f){await f.page.evaluate(async()=>{const s=await import('/src/crypto/store.ts');const assignment=new URL(location.href).searchParams.get('assignment')||undefined;try{await s.prepareContext(assignment)}catch(e){if(e.message!=='crypto.review_required')throw new Error('capture_prepare_failed');await s.prepareContext(assignment,true)}})}

export async function capture(f){await f.page.locator('a.nav-item[href="/camera"]').click();await button(f.page,'Попробовать без камеры').click();await button(f.page,'Снять фото').click();await expect.poll(()=>f.page.evaluate(async()=>{const p=await import('/src/crypto/photos.ts');return(await p.jobs()).length}),{timeout:30000}).toBeGreaterThan(0)}
export async function jobs(f){return f.page.evaluate(async()=>{const p=await import('/src/crypto/photos.ts');return(await p.jobs()).map(j=>({id:j.id,received:j.received,epoch:j.submission.epoch,expiresAt:j.expiresAt,pending:!!j.objects.original.pending,hash:j.objects.original.packet.statement.ciphertextHash,encryptionEpoch:j.objects.original.packet.statement.descriptor.encryption_epoch,recipients:j.objects.original.packet.envelopes.map(e=>e.accountId)}))})}
export async function received(f,count){await expect.poll(async()=>(await jobs(f)).filter(j=>j.received).length,{timeout:30000}).toBe(count)}
