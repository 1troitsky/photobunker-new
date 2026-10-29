// API outage on cold restart; dev shell stays online (real PWA caching is R01).
import {chromium,webkit,expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {origin,button,label,accountFixture,cleanupFixtures,monitorRuntime} from './account-qa.mjs'
import {enrollPhotos,preparePhotos,jobs,received} from './photo-qa.mjs'
for(const engine of(process.env.PHOTO_BROWSERS??'chromium,webkit').split(',')){
 const browser=await({chromium,webkit}[engine]).launch({headless:true}),fixtures=[],errors=[],diagnostics={nativePhotoPoll:0};let stage='enrollment'
 try{
  const f=await accountFixture(browser,`${engine} cold API outage`,fixtures);await monitorRuntime(f.page,engine,errors,diagnostics);await enrollPhotos(f);await preparePhotos(f)
  stage='cold-api-outage';await f.page.locator('a.nav-item[href="/camera"]').click();await f.page.route('**/api/**',route=>route.abort());await f.page.reload();await expect(f.page.locator('.native-camera')).toHaveAttribute('data-protection','encrypted',{timeout:30000});await expect(button(f.page,'Попробовать без камеры')).toBeEnabled();await button(f.page,'Попробовать без камеры').click();await button(f.page,'Снять фото').click();await expect.poll(async()=>(await jobs(f)).length,{timeout:30000}).toBe(1);const row=(await jobs(f))[0];assert.equal(row.received,false);assert.equal(row.pending,true);assert.equal(await f.page.evaluate(async()=>{const l=await import('/src/local/photos.ts');return(await l.listPhotos()).length}),0)
  stage='delivery-after-restart';await f.page.unroute('**/api/**');await f.page.evaluate(async()=>{const p=await import('/src/crypto/photos.ts');await p.deliver()});await received(f,1);await f.page.evaluate(async()=>{const s=await import('/src/crypto/store.ts');s.resumeTrustedPhotos()});await f.page.locator('a.nav-item[href="/gallery"]').click();await expect(f.page.locator('.native-photo-tile')).toHaveCount(1,{timeout:30000})
  assert.deepEqual(errors,[]);console.log(`${engine}: cold API-outage capture stays encrypted, no plaintext fallback, queued restart/delivery and trusted automatic reopen passed`)
 }catch(error){console.error(`${engine}: offline photos failed at ${stage} (${error.name}), ${error.stack?.match(/check-photo-offline.mjs:\d+:\d+/)?.[0]??'unknown'}`);throw new Error('photo_offline_qa_failed')}finally{await cleanupFixtures(fixtures);await browser.close()}
}
