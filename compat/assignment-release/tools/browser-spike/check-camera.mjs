// Uses Chromium's synthetic camera through the real getUserMedia/ImageCapture pipeline.
// This does not establish iPhone/Android hardware quality or support.
import {chromium,expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {accountFixture,cleanupFixtures} from './account-qa.mjs'
const origin=process.env.LOCAL_APP_URL??'http://localhost:8080'
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Use a loopback test origin')
const browser=await chromium.launch({headless:true,...(process.env.APP_CHROME_CHANNEL?{channel:process.env.APP_CHROME_CHANNEL}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
const fixtures=[]
try{
 const fixture=await accountFixture(browser,'synthetic encrypted camera',fixtures);const context=fixture.context;await context.grantPermissions(['camera'])
 await fixture.page.evaluate(async id=>{const db=await import('/src/crypto/database.ts');await db.remove(`context:${id}:personal`)},fixture.me.account.id)
 const page=fixture.page,errors=[]
 page.on('pageerror',error=>errors.push({name:error.name,sources:error.stack?.match(/src\/[a-zA-Z0-9_/.:-]+/g)??[]}))
 await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.qaCameraStreams=[];navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);window.qaCameraStreams.push(stream);return stream}})
 await page.goto(`${origin}/camera`)
 assert.equal(await page.evaluate(()=>window.qaCameraStreams.length),0)
 await page.getByRole('button',{name:'Включить камеру',exact:true}).click()
 const shutter=page.getByRole('button',{name:'Снять фото',exact:true})
 await expect(shutter).toBeEnabled()
 await shutter.click()
 await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/crypto/photos.ts')).jobs()).length)).toBe(1)
 const photo=await page.evaluate(async()=>(await(await import('/src/crypto/photos.ts')).index()).photos[0])
 assert.ok(photo.width>0&&photo.height>0)
 assert.ok(['image-capture','video-frame'].includes(photo.method))
 await page.getByRole('navigation').getByRole('link',{name:'Фото',exact:true}).click()
 assert.ok(await page.evaluate(()=>window.qaCameraStreams.flatMap(stream=>stream.getTracks()).every(track=>track.readyState==='ended')))
 await expect(page.locator('.native-photo-tile')).toHaveCount(1)
 await page.locator('.native-photo-tile').click();await expect(page.locator('.photo-view-stage img')).toBeVisible()
 // Some browsers expose a constructor that cannot capture this track.
 await page.goto(`${origin}/camera`)
 await page.evaluate(()=>{window.ImageCapture=class{constructor(){throw new DOMException('Synthetic unsupported track','NotSupportedError')}}})
 await page.getByRole('button',{name:'Включить камеру',exact:true}).click();await expect(shutter).toBeEnabled();await shutter.click()
 await expect.poll(()=>page.evaluate(async()=>(await(await import('/src/crypto/photos.ts')).jobs()).length)).toBe(2)
 const fallback=await page.evaluate(async()=>(await(await import('/src/crypto/photos.ts')).index()).photos.find(photo=>photo.method==='video-frame'))
 assert.ok(fallback&&fallback.width>0&&fallback.height>0)
 await page.getByRole('button',{name:'Скрыть приложение',exact:true}).click()
 assert.ok(await page.evaluate(()=>window.qaCameraStreams.flatMap(stream=>stream.getTracks()).every(track=>track.readyState==='ended')))
 assert.deepEqual(errors,[])
 console.log(`Chromium synthetic hardware: explicit permission, real ${photo.method}, stored/reopened ${photo.width}x${photo.height}, unsupported-still video fallback and released tracks on navigation/Quick Exit passed`)
 await context.close()
}finally{await cleanupFixtures(fixtures);await browser.close()}
