// Synthetic account only. Never log kits, ciphertext envelopes or photo data.
import {chromium,webkit,expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {enrollPhotos,preparePhotos} from './photo-qa.mjs'
import {origin,headers,button,label,accountFixture,cleanupFixtures,monitorRuntime} from './account-qa.mjs'
for(const engine of (process.env.PHOTO_BROWSERS??'chromium,webkit').split(',')){
 const browser=await({chromium,webkit}[engine]).launch({headless:true}),fixtures=[],errors=[],requests=[],diagnostics={nativePhotoPoll:0}
 let stage='account'
 try{
  const f=await accountFixture(browser,`${engine} photo crypto`,fixtures,{legacy:true});await monitorRuntime(f.page,engine,errors,diagnostics);f.page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.includes('/identity/secure/'))requests.push([path.replace(/[0-9a-f-]{36}/g,':id'),response.status()])})
  stage='enrollment';await enrollPhotos(f);assert.ok(f.photoKit.startsWith('PB4.'));await preparePhotos(f)
  stage='security-layout';for(const width of [320,390,768,1440]){await f.page.setViewportSize({width,height:844});assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Protection overflow at ${width}`)}await f.page.setViewportSize({width:390,height:844});
  stage='locked-api';assert.equal((await f.context.request.get(`${origin}/api/v1/identity/secure/photos`,{headers})).status(),423)
  stage='capture';await f.page.getByRole('link',{name:'Камера',exact:true}).last().click();await button(f.page,'Попробовать без камеры').click();await button(f.page,'Снять фото').click()
  stage='delivery';await expect.poll(()=>f.page.evaluate(async()=>{const db=await import('/src/crypto/database.ts');const rows=await db.list('job:');return rows.length&&rows[0].received}),{timeout:30000}).toBe(true)
  const saved=await f.page.evaluate(async()=>{const db=await import('/src/crypto/database.ts');const rows=await db.list('job:');const row=rows[0];return {id:row.id,hasPending:Object.values(row.objects).some(o=>o.pending),retainedBytes:Object.values(row.objects).reduce((s,o)=>s+o.bytes.byteLength,0),hasTitle:JSON.stringify(row).includes('captureContext')}});assert.equal(saved.hasPending,false);assert.equal(saved.retainedBytes,0);assert.equal(saved.hasTitle,false)
  stage='gallery';await f.page.getByRole('link',{name:'Фото',exact:true}).last().click();await expect(f.page.locator('.native-photo-tile')).toHaveCount(1,{timeout:30000})
  stage='cold-auto-open';await f.page.reload();await expect(f.page.locator('.native-photo-tile')).toHaveCount(1,{timeout:30000});await f.page.locator('.native-photo-tile').first().click();await expect(f.page.locator('.photo-view-stage img')).toBeVisible({timeout:30000})

  assert.deepEqual(errors,[]);console.log(`${engine}: PB1-bound PB4 enrollment, ciphertext queue/ACK cleanup, real upload/decrypt and trusted-device automatic reopen passed`)
 }catch(error){console.error(`${engine}: photo crypto QA failed at ${stage} (${error.name}); location ${error.stack?.match(/check-photo-crypto.mjs:\d+:\d+/)?.[0]??'unknown'}`);console.error({requests,errors,diagnostics});console.error(await fDiagnostic(fixtures.at(-1)?.page));throw new Error('photo_crypto_qa_failed')}finally{await cleanupFixtures(fixtures);await browser.close()}
}

async function fDiagnostic(page){return page?{error:await page.locator('.form-error').textContent({timeout:500}).catch(()=>''),status:await page.getByRole('status').allTextContents(),queue:await page.evaluate(async()=>{const db=await import('/src/crypto/database.ts');const rows=await db.list('job:');return {count:rows.length,received:rows.filter(r=>r.received).length}})}:{} }
