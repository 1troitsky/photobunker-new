// Synthetic accounts only. Never print fragment secrets, keys, photo data or request bodies.
import {chromium,webkit,expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {origin,headers,button,label,accountFixture,cleanupFixtures,monitorRuntime,labelQaDevice} from './account-qa.mjs'
import {enrollPhotos,preparePhotos,capture,received,jobs,unlockPhotos} from './photo-qa.mjs'
async function checkMaskTransforms(page){assert.equal(await page.evaluate(async()=>{const {renderEdits}=await import('/src/studio/render.ts'),{emptyEdits}=await import('/src/studio/versions.ts');const c=document.createElement('canvas');c.width=400;c.height=300;c.getContext('2d').fillStyle='#ff0000';c.getContext('2d').fillRect(0,0,400,300);const img=new Image();img.src=c.toDataURL();await img.decode();for(const rotation of [0,1,2,3])for(const mirror of [false,true])for(const crop of ['native','1:1']){const edits={...emptyEdits(),rotation,mirror,crop,shapes:[{id:crypto.randomUUID(),kind:'redact',from:{x:.1,y:.1},to:{x:.5,y:.5},color:'#fff',width:.01}]},canvas=renderEdits(img,edits),pair=[[[.3,.3],[.7,.3]],[[.7,.3],[.7,.7]],[[.7,.7],[.3,.7]],[[.3,.7],[.3,.3]]][rotation][mirror?1:0],rw=rotation%2?300:400,rh=rotation%2?400:300,side=Math.min(rw,rh),p=crop==='native'?{x:pair[0],y:pair[1]}:{x:(pair[0]*rw-(rw-side)/2)/side,y:(pair[1]*rh-(rh-side)/2)/side},rgb=canvas.getContext('2d').getImageData(Math.floor(p.x*canvas.width),Math.floor(p.y*canvas.height),1,1).data;if(!Array.from(rgb).slice(0,3).every(v=>v===0))return false;canvas.width=canvas.height=0}return true}),true)}
// Render regressions for R1-09. Tests run in an actual browser canvas,
 // never in the jsdom Canvas2D shim.
async function checkEditorPixels(page) {
  const result = await page.evaluate(async () => {
    const {renderEdits} = await import('/src/studio/render.ts')
    const {emptyEdits} = await import('/src/studio/versions.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 400; canvas.height = 300
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,400,300)
    const untouched = canvas.toDataURL()
    const image = new Image(); image.src = untouched; await image.decode()
    const pixel = (edits, x=.5, y=.5) => {
      const result=renderEdits(image,edits)
      const data=Array.from(result.getContext('2d').getImageData(
        Math.floor(result.width*x),Math.floor(result.height*y),1,1).data)
      result.width=result.height=0; return data
    }
    const square={id:'shape',kind:'rectangle',from:{x:.2,y:.2},to:{x:.8,y:.8},
      color:'#ff0000',width:.01}
    const outline=pixel({...emptyEdits(),shapes:[square]})
    const filled=pixel({...emptyEdits(),shapes:[{...square,filled:true}]})
    const ellipse=pixel({...emptyEdits(),shapes:[{...square,kind:'ellipse',filled:true}]})
    const stroke=(tool)=>({...emptyEdits(),strokes:[{id:'ink',tool,
      color:'#000000',opacity:1,width:.045,points:[{x:.25,y:.5},{x:.75,y:.5}]}]})
    const soft=pixel(stroke('brush'),.5,.53)
    const fine=pixel(stroke('pencil'),.5,.53)
    const erased=pixel({...stroke('brush'),strokes:[...stroke('brush').strokes,
      {id:'eraser',tool:'eraser',color:'#fff',opacity:1,width:.09,
       points:[{x:.4,y:.5},{x:.6,y:.5}]}]})
    return {outline,filled,ellipse,soft,fine,erased,unchanged:canvas.toDataURL()===untouched}
  })
  assert.ok(result.unchanged,'Editor must never mutate the original image')
  assert.ok(result.outline.slice(0,3).every(v=>v===255),'Legacy outline remains unfilled')
  assert.ok(result.filled[0]>230 && result.filled[1]<40,'Filled rectangle burns into pixels')
  assert.ok(result.ellipse[0]>230 && result.ellipse[1]<40,'Filled ellipse burns into pixels')
  assert.ok(result.soft[0]<result.fine[0],'Brush has a wider/softer stroke than pencil')
  assert.ok(result.erased.slice(0,3).every(v=>v===255),'Eraser reveals original pixels')
}
async function checkMissingVersion(page,id){await page.goto(`${origin}/gallery/${id}?version=${crypto.randomUUID()}`);await expect(page.getByRole('alert')).toContainText('Эта версия сейчас недоступна');await expect(page.locator('.photo-view-stage img')).toHaveCount(0);await button(page,'Поделиться').click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.goto(`${origin}/gallery/${id}/edit?version=${crypto.randomUUID()}`);await expect(page.getByRole('alert')).toContainText('Эта версия сейчас недоступна');await expect(page.locator('canvas')).toHaveCount(0);await expect(button(page,'Сохранить версию')).toBeDisabled()}
for(const engine of (process.env.PHOTO_BROWSERS??'chromium,webkit').split(',')){
 const browser=await({chromium,webkit}[engine]).launch({headless:true}),fixtures=[],contexts=[],errors=[],diagnostics={nativePhotoPoll:0},http=[];let stage='account'
 try{
  if(process.env.EDITOR_RENDER_ONLY==='1'){const page=await browser.newPage();await page.goto(`${origin}/profile`);await checkMaskTransforms(page);await checkEditorPixels(page);console.log(`${engine}: solid masks survive all quarter-turns, mirrors and crop transforms`);continue}
  const f=await accountFixture(browser,`${engine} B05`,fixtures);await monitorRuntime(f.page,engine,errors,diagnostics)
  f.page.on('response',async r=>{if(new URL(r.url()).pathname.includes('/secure/')&&r.status()>=400)http.push({status:r.status(),kind:new URL(r.url()).pathname.split('/').at(-1),code:(await r.json().catch(()=>({}))).code})})
  stage='photo-enrollment';await enrollPhotos(f);await unlockPhotos(f)
  stage='photo-context';await preparePhotos(f)
  stage='photo-capture';await capture(f)
  stage='photo-delivery';await received(f,1);const id=(await jobs(f))[0].id
  if(process.env.EDITOR_MISSING_ONLY==='1'){await checkMissingVersion(f.page,id);console.log(`${engine}: missing versions never fall back to the original in viewing, editing or sharing`);continue}
  stage='editor-controls';await f.page.goto(`${origin}/gallery/${id}/edit`);const editorCanvas=f.page.locator('canvas');await expect(editorCanvas).toBeVisible({timeout:30000})
  await f.page.getByRole('tab',{name:'Рисунок',exact:true}).click();for(const name of ['Кисть','Карандаш','Ластик'])await expect(button(f.page,name).locator('svg')).toHaveCount(1)
  await editorCanvas.evaluate(canvas=>canvas.scrollIntoView({block:'center'}));let box=await editorCanvas.boundingBox();const untouched=await editorCanvas.evaluate(canvas=>canvas.toDataURL());await f.page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await f.page.mouse.down();await f.page.mouse.move(box.x+box.width*.65,box.y+box.height*.65,{steps:8});await f.page.mouse.up();await expect.poll(()=>editorCanvas.evaluate(canvas=>canvas.toDataURL())).not.toBe(untouched)
  await editorCanvas.focus();await f.page.keyboard.press('Control+z');await expect.poll(()=>editorCanvas.evaluate(canvas=>canvas.toDataURL())).toBe(untouched);await f.page.keyboard.press('Control+Shift+z');await expect.poll(()=>editorCanvas.evaluate(canvas=>canvas.toDataURL())).not.toBe(untouched)
  await f.page.getByRole('tab',{name:'Текст',exact:true}).click();await expect(label(f.page,'Текст')).toBeFocused();await f.page.getByRole('tab',{name:'Фигуры',exact:true}).click();await label(f.page,'Заливка').check();await expect(label(f.page,'Заливка')).toBeChecked();await button(f.page,'Сбросить изменения').click()
  stage='redaction-ui';await f.page.getByRole('tab',{name:'Приватность',exact:true}).click()
  await editorCanvas.evaluate(canvas=>canvas.scrollIntoView({block:'center'}));box=await editorCanvas.boundingBox();const start={x:box.x+box.width*.2,y:box.y+box.height*.2};const target=await f.page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,start);assert.equal(target,'CANVAS',`pointer_target_${target}`);await f.page.mouse.move(start.x,start.y);await f.page.mouse.down();await f.page.mouse.move(box.x+box.width*.65,box.y+box.height*.65,{steps:8});await f.page.mouse.up()
  await label(f.page,'Водяной знак').fill('QA export mark');await label(f.page,'Водяной знак').blur()
  await button(f.page,'Сохранить версию').click();await expect(f.page).toHaveURL(/\/gallery\/[^/]+\?version=/,{timeout:30000});await expect(f.page.locator('.photo-view-stage img')).toBeVisible()
  stage='cloud-version';const first=await f.page.evaluate(async id=>{const p=await import('/src/server/photos.ts'),v=await import('/src/studio/versions.ts');const photo=(await p.readPhoto(id)).photo,rows=await v.listPhotoVersions(photo);return rows.map(r=>({id:r.id,sync:r.sync,conflict:r.conflict,shapes:r.edits.shapes?.length,coversCenter:r.edits.shapes?.some(s=>Math.min(s.from.x,s.to.x)<.4&&Math.max(s.from.x,s.to.x)>.4&&Math.min(s.from.y,s.to.y)<.4&&Math.max(s.from.y,s.to.y)>.4)}))},id)
  assert.equal(first.length,1);assert.equal(first[0].sync,'synced');assert.equal(first[0].shapes,1,`shape_count_${first[0].shapes}`);assert.equal(first[0].coversCenter,true)
  stage='new-device';const context=await browser.newContext({locale:'ru-RU',viewport:{width:390,height:844}});contexts.push(context);const page=await context.newPage();await monitorRuntime(page,engine,errors,diagnostics)
  await page.goto(`${origin}/profile/account?mode=recover`);await label(page,'Ключ аккаунта').fill(f.kit);await button(page,'Готово').click();await expect(page).toHaveURL(`${origin}/profile`);await labelQaDevice(page,'QA B05 second device');
  const second={page,context,photoKit:f.photoKit,me:await(await context.request.get(`${origin}/api/v1/identity/me`,{headers})).json()};await unlockPhotos(second)
  await page.goto(`${origin}/gallery/${id}?version=${first[0].id}`);await expect(page.locator('.photo-view-stage img')).toBeVisible({timeout:30000})
  const reopened=await page.evaluate(async id=>{const p=await import('/src/server/photos.ts'),v=await import('/src/studio/versions.ts');return(await v.listPhotoVersions((await p.readPhoto(id)).photo)).map(r=>({id:r.id,sync:r.sync,shapes:r.edits.shapes?.length}))},id);assert.equal(reopened[0].id,first[0].id);assert.equal(reopened[0].shapes,1)
  stage='concurrent-save';const conflict=await page.evaluate(async id=>{const p=await import('/src/server/photos.ts'),v=await import('/src/studio/versions.ts'),r=await p.readPhoto(id);const edits=v.emptyEdits();edits.watermark='QA concurrent';const version=await v.savePhotoVersion(r.photo,r.blob,r.photo.width,r.photo.height,edits,null);return {sync:version.sync,conflict:version.conflict}},id);assert.equal(conflict.sync,'synced');assert.equal(conflict.conflict,true)
  stage='offline-draft-ui';await f.page.goto(`${origin}/gallery/${id}/edit?version=${first[0].id}`);await expect(f.page.locator('canvas')).toBeVisible({timeout:30000});await f.page.getByRole('tab',{name:'Приватность',exact:true}).click();await label(f.page,'Водяной знак').fill('QA offline UI');await label(f.page,'Водяной знак').blur();await f.context.setOffline(true);await button(f.page,'Сохранить версию').click();await expect(f.page.getByRole('status').filter({hasText:'Версия сохранена на устройстве'})).toBeVisible();const draft=await f.page.evaluate(async id=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('photobunker-encrypted-queue-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('qa.storage'))}),rows=await new Promise(resolve=>{const tx=db.transaction('entries'),r=tx.objectStore('entries').getAll();tx.oncomplete=()=>resolve(r.result)});db.close();return rows.filter(r=>r.parentId===id&&!r.synced).map(r=>({id:r.id,pending:!!r.image.bytes.byteLength}))},id);assert.equal(draft.length,1);assert.equal(draft[0].pending,true);await f.context.setOffline(false)
  const synced=await f.page.evaluate(async id=>{const p=await import('/src/server/photos.ts'),v=await import('/src/studio/versions.ts');return(await v.listPhotoVersions((await p.readPhoto(id)).photo)).map(r=>({id:r.id,sync:r.sync}))},id);assert.equal(synced.find(r=>r.id===draft[0].id).sync,'synced')

  stage='mask-transforms';await checkMaskTransforms(f.page);await checkEditorPixels(f.page)
  stage='missing-version';await checkMissingVersion(page,id)
  stage='private-link-ui';await f.page.goto(`${origin}/gallery/${id}?version=${first[0].id}`);await expect(f.page.locator('.photo-view-stage img')).toBeVisible({timeout:30000});await expect(f.page.getByRole('alert')).toHaveCount(0);await button(f.page,'Поделиться').click();await button(f.page,'Создать приватную ссылку').click();const linkField=f.page.locator('textarea[readonly]');await expect(linkField).toBeVisible({timeout:30000});const link=await linkField.inputValue();assert.ok(new URL(link).hash.length>40)
  stage='anonymous-recipient';const publicContext=await browser.newContext({locale:'ru-RU'});contexts.push(publicContext);const publicPage=await publicContext.newPage();await monitorRuntime(publicPage,engine,errors,diagnostics)
  const outgoing=[];publicPage.on('request',r=>{outgoing.push({url:r.url(),body:r.postData()??''})})
  await publicPage.goto(link);await expect(publicPage.getByRole('img')).toBeVisible({timeout:30000});assert.equal(await publicPage.locator('nav').count(),0);assert.equal(await button(publicPage,'Сохранить файл').count(),0);assert.equal(new URL(publicPage.url()).hash,'')
  const pixel=await publicPage.getByRole('img').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);return Array.from(x.getImageData(Math.floor(c.width*.4),Math.floor(c.height*.4),1,1).data)});assert.ok(pixel.slice(0,3).every(v=>v<8),'Redacted pixels must be burned into recipient JPEG')
  const secret=new URL(link).hash.slice(1);assert.ok(outgoing.every(r=>!r.url.includes(secret)&&!r.body.includes(secret)))
  stage='wrong-fragment';const wrong=await publicContext.newPage();await wrong.goto(link.split('#')[0]+'#invalid');await expect(wrong.getByRole('alert')).toBeVisible();await expect(wrong.getByRole('img')).toHaveCount(0)
  stage='revoke';await button(f.page,'Отозвать').click();await expect(f.page.getByText('Отозвана',{exact:true})).toBeVisible();await expect(publicPage.getByRole('img')).toHaveCount(0,{timeout:20000});assert.equal((await publicContext.request.get(link.split('#')[0].replace('/s/','/api/v1/shares/'))).status(),410)
  stage='download-scope';await label(f.page,'Доступ по ссылке').selectOption('download');await button(f.page,'Создать приватную ссылку').click();await expect(linkField).toBeVisible();const downloadable=await linkField.inputValue();await publicPage.goto(downloadable);await expect(button(publicPage,'Сохранить файл')).toBeVisible({timeout:30000})
  stage='parent-expiry';await f.page.evaluate(async id=>{const p=await import('/src/server/photos.ts'),r=await p.readPhoto(id);await p.updatePhoto(id,{title:r.photo.title,note:r.photo.note,favorite:r.photo.favorite,expiresAt:Date.now()+2000},r.photo.remoteRevision,r.photo)},id)
  await expect(publicPage.getByRole('img')).toHaveCount(0,{timeout:20000})
  assert.deepEqual(errors,[])
  console.log(`${engine}: redaction pixels, cloud versions/new device, conflict preservation, offline encrypted draft/retry, anonymous fragment link, no secret on wire, wrong-key denial, scopes, revoke and parent expiry passed`)
 }catch(error){console.error({engine,stage,name:error.name,code:error.message?.match(/(?:crypto\.[a-z_]+|capture_prepare_failed|shape_count_[^\s]+|pointer_target_[^\s]+)/)?.[0],http,errors,diagnostics});console.error(String(error.stack).split('\n').filter(l=>l.includes('check-editor-sharing.mjs')&&l.trim().startsWith('at ')).join('\n'));process.exitCode=1;break}finally{await Promise.all(contexts.map(c=>c.close()));await cleanupFixtures(fixtures);await browser.close()}
}
