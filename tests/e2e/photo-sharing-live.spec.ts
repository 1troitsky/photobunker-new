import {chromium,expect,test,type Page} from '@playwright/test'

/**
 * Runs against the real PB2 UI, Identity v2 sessions, PostgreSQL and Garage.
 * Intentionally skips outside a disposable local/staging E2EE environment.
 * Nothing is mocked; never expose invitation codes in assertions or logs.
 */
const origin=process.env.PB_PHOTO_SHARE_LIVE_ORIGIN
test.skip(!origin,'Requires isolated PB2 Identity + PostgreSQL + Garage browser runtime')
test.use({trace:'off'})
test.setTimeout(210_000)
test.describe.configure({retries:0})

async function createAccount(page:Page):Promise<string>{
  const failures:string[]=[]
  const observe=(response:import('@playwright/test').Response)=>{
    const url=new URL(response.url())
    if(url.pathname.startsWith('/identity/v2/')&&response.status()>=400){
      // Playwright's synchronous headers() intentionally omits security headers.
      // The async allHeaders() exposes Origin without logging secrets/credentials.
      void Promise.all([response.request().allHeaders(),response.allHeaders(),
        response.status()===403?response.json().catch(()=>null):Promise.resolve(null)])
        .then(([requestHeaders,responseHeaders,error])=>{
          const from=requestHeaders['origin']??'<absent>'
          // Only emit an error category from a fixed allowlist, never raw bodies.
          const msg=error&&typeof error==='object'&&'message' in error?error.message:null
          const kind=msg==='Origin mismatch.'?'origin_mismatch':
            msg==='Forbidden.'?'forbidden':msg==='CSRF token mismatch.'?'csrf':'unspecified'
          failures.push(url.pathname.split('/').slice(0,5).join('/')+':'+response.status()+
            ' origin='+from+' responseType='+String(responseHeaders['content-type']??'none')+
            ' server='+String(responseHeaders['server']??'none')+' reason='+kind)
        }).catch(()=>failures.push(url.pathname+':'+response.status()))
    }
  }
  page.on('response',observe)
  await page.goto('/account/create')
  await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
  // Do not let a failing Playwright assertion print the generated recovery key.
  expect((await page.locator('#identity-key').inputValue()).startsWith('PB2.')).toBe(true)
  await page.locator('input[type=checkbox]').check()
  await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
  try{
    await expect(page).toHaveURL(/\/profile$/,{timeout:25000})
  }catch(e){
    const visible=(await page.getByRole('alert').allTextContents()).join(' ').slice(0,300)
    throw new Error('live_identity_create_failed: http='+failures.join(',')+
      ' visible_error='+visible,{cause:e})
  }finally{page.off('response',observe)}
  await page.goto('/contacts')
  // The shell renders before the nonblocking identity/collaboration bootstrap.
  // Wait for the real account ID instead of reading the initial empty node.
  const accountCode=page.locator('.collab-panel code').first()
  await expect.poll(async()=>((await accountCode.textContent())??'').trim(),
    {timeout:20000}).toMatch(/^[a-f0-9-]{36}$/)
  return ((await accountCode.textContent())??'').trim()
}

async function syncContacts(page:Page,other:string):Promise<void>{
  await page.goto('/contacts')
  await expect.poll(async()=>{
    await page.getByRole('button',{name:/^Retry$|^Повторить$/i}).first().click()
    return await page.locator('.collab-person').filter({hasText:other}).count()
  },{intervals:[750,1200,2000],timeout:30000}).toBe(1)
}

test('two browsers: grant invite, genuine camera photo and recipient E2EE decryption',async()=>{
  const browser=await chromium.launch({args:[
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  ]})
  const ownerContext=await browser.newContext({baseURL:origin,permissions:['camera']})
  const recipientContext=await browser.newContext({baseURL:origin})
  const owner=await ownerContext.newPage(),recipient=await recipientContext.newPage()
  try{
    const ownerId=await createAccount(owner)
    const recipientId=await createAccount(recipient)
    expect(ownerId).not.toBe(recipientId)

    // Real, device-signed contact invitation and acknowledgement.
    await owner.goto('/contacts')
    await owner.getByRole('textbox',{name:/Request contact by account ID|Пригласить контакт по ID/i})
      .fill(recipientId)
    await owner.getByRole('button',{name:/Send request|Отправить запрос/i}).click()
    await syncContacts(recipient,ownerId)
    await recipient.locator('.collab-list li').filter({hasText:ownerId})
      .getByRole('button',{name:/^Accept$|^Принять$/i}).click()
    await recipient.getByRole('button',{name:/Retry|Повторить/i}).first().click()
    await syncContacts(owner,recipientId)
    await expect(owner.locator('.collab-list li').filter({hasText:recipientId}))
      .toContainText(/Accepted contact|Контакт принят/i,{timeout:30000})

    // Encrypted assignment is created and acknowledged before its first photo.
    await owner.goto('/assignments/new')
    await owner.getByRole('textbox',{name:/^Title$|^Название$/i})
      .fill('Shared browser E2EE assignment')
    await owner.getByRole('textbox',{name:/^Instructions$|^Инструкции$/i})
      .fill('Keep original private; only encrypted thumbnail may be shared.')
    await owner.getByRole('button',{name:/^Save$|^Сохранить$/i}).click()
    await expect(owner).toHaveURL(/\/assignments\/[a-f0-9-]{36}$/)
    const assignmentPath=new URL(owner.url()).pathname
    const assignmentId=assignmentPath.split('/').pop()!
    await owner.goto('/assignments')
    await owner.getByRole('button',{name:/Sync now|Синхронизировать/i}).click()
    await expect(owner.locator('.assignment-item').filter({hasText:'Shared browser E2EE assignment'}))
      .toContainText(/Synced|Синхронизировано/i,{timeout:45000})
    await owner.goto(assignmentPath)
    await owner.getByRole('button',{name:/^In progress$|^В работе$/i}).click()
    // Only the server-acknowledged in-progress state exposes the camera route.
    await expect(owner.getByRole('link',
      {name:/Capture in assignment|Снимать в задании/i})).toBeVisible({timeout:45000})

    // Invitation code is exchanged ONLY in test-process memory; never in URL.
    await owner.goto('/assignment-grants?assignment='+assignmentId)
    await owner.getByRole('textbox',{name:/Recipient account ID|ID аккаунта получателя/i})
      .fill(recipientId)
    await owner.getByRole('button',{name:/Create invitation|Создать приглашение/i}).click()
    await expect(owner.locator('.grant-code code')).toBeVisible()
    const code=(await owner.locator('.grant-code code').textContent())!.trim()
    await owner.getByRole('button',{name:/Send pending operations|Отправить ожидающие операции/i}).click()
    await recipient.goto('/assignment-grants')
    await recipient.getByRole('button',{name:/^Refresh$|^Обновить$/i}).first().click()
    const incoming=recipient.locator('.grant-entry').filter({hasText:assignmentId})
    await expect.poll(async()=>{
      await recipient.getByRole('button',{name:/^Refresh$|^Обновить$/i}).first().click()
      return await incoming.count()
    },{intervals:[750,1500,2200],timeout:30000}).toBe(1)
    await incoming.locator('input[type=password]').fill(code)
    await incoming.getByRole('button',{name:/^Accept$|^Принять$/i}).click()
    await recipient.getByRole('button',{name:/Send pending operations|Отправить ожидающие операции/i}).click()
    await expect(incoming).toContainText(/Invitation accepted|Приглашение принято/i,{timeout:45000})

    await owner.goto(assignmentPath)
    await owner.getByRole('link',{name:/Capture in assignment|Снимать в задании/i}).click()
    const camera=owner.getByTestId('production-camera')
    await expect(camera.locator('select').first()).toHaveValue(assignmentId,{timeout:30000})
    await owner.getByRole('button',{name:/Enable camera|Включить камеру/i}).click()
    await expect(owner.getByRole('button',{name:/Take photo|Снять фото/i})).toBeEnabled()
    await expect.poll(async()=>camera.locator('video').evaluate(v=>
      (v as HTMLVideoElement).videoWidth),{timeout:15000}).toBeGreaterThan(0)
    await owner.getByRole('button',{name:/Revalidate server time|Проверить время сервера/i}).click()
    await expect(camera.locator('.status-pill')).toContainText('UTC ✓',{timeout:15000})
    await owner.getByRole('button',{name:/Take photo|Снять фото/i}).click()
    // Read only nonsecret camera feedback; don't log frame bytes or keys.
    await expect.poll(async()=>{
      const saved=(await camera.locator('.camera-feedback[role=status]').allTextContents()).join(' ')
      if(/Encrypted on this device|Сохранено зашифрованно/i.test(saved))return 'saved'
      const alert=(await camera.locator('.camera-feedback[role=alert]').allTextContents()).join(' ')
      return alert?'camera error: '+alert:'pending'
    },{timeout:30000,intervals:[300,800,1300]}).toBe('saved')
    // First use real SPA navigation: this must not reset the encrypted vault.
    await camera.locator('a[href="/photos"]').click()
    // /photos mounts the real GalleryScreen; LocalPhotosScreen is a legacy-unused view.
    const photos=owner.getByTestId('encrypted-gallery')
    const localPhotoState=async()=>{
      if(await photos.locator('.gallery-item').count())return 'visible'
      const alert=(await photos.getByRole('alert').allTextContents()).join(' ').slice(0,180)
      if(alert)return 'alert: '+alert
      const gate=(await photos.locator('.gallery-empty').allTextContents()).join(' ').slice(0,140)
      if(gate)return 'gate: '+gate
      const statuses=(await photos.getByRole('status').allTextContents()).join(' ').slice(0,140)
      return 'pending: '+statuses
    }
    await expect.poll(localPhotoState,{timeout:20000}).toBe('visible')
    // Next verify a full reload (session restore + decrypting the same photo).
    await owner.reload()
    await expect.poll(localPhotoState,{timeout:20000}).toBe('visible')
    await owner.getByRole('button',{name:/Sync now|Синхронизировать/i}).click()
    await expect(photos.locator('.gallery-item .gallery-state').first())
      .toContainText(/Cloud verified|В облаке/i,{timeout:90000})

    // Explicit owner approval wraps that photo's existing thumbnail DEK.
    await owner.goto('/assignment-grants?assignment='+assignmentId)
    const outgoing=owner.locator('.grant-entry').filter({hasText:recipientId})
    await expect(outgoing).toContainText(/Invitation accepted|Приглашение принято/i,{timeout:30000})
    await outgoing.getByRole('combobox',{name:/Select a photo|Выберите снимок/i}).selectOption({index:1})
    await outgoing.getByRole('button',{name:/Prepare encrypted thumbnail|Подготовить миниатюру/i}).click()
    await expect(owner.locator('.grant-operation').filter({
      hasText:/Server confirmed|Подтверждено сервером/i,
    })).toHaveCount(1,{timeout:60000})

    // Recipient sees only encrypted thumbnail; genuine WebCrypto decrypts
    // through invitation-pinned owner identity and per-asset DEK.
    await recipient.goto('/assignment-grants')
    const accepted=recipient.locator('.grant-entry').filter({hasText:assignmentId})
    await expect(accepted).toContainText(/Invitation accepted|Приглашение принято/i)
    await accepted.getByRole('link',{name:/Received thumbnails|Полученные миниатюры/i}).click()
    await expect(recipient.locator('.recipient-photo')).toHaveCount(1,{timeout:45000})
    await recipient.getByRole('button',{name:/Decrypt thumbnail|Расшифровать миниатюру/i}).click()
    const image=recipient.locator('.recipient-preview')
    await expect(image).toBeVisible({timeout:30000})
    expect(await image.evaluate(el=>({
      source:(el as HTMLImageElement).currentSrc,
      width:(el as HTMLImageElement).naturalWidth,
      height:(el as HTMLImageElement).naturalHeight,
    }))).toMatchObject({source:expect.stringMatching(/^blob:/),
      width:expect.any(Number),height:expect.any(Number)})
    expect(await image.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    // A revoked grant is re-checked by the receiving browser; no old
    // object URL remains open, and re-requesting ciphertext is denied.
    await owner.goto('/assignment-grants')
    await owner.locator('.grant-entry').filter({hasText:recipientId})
      .getByRole('button',{name:/^Revoke$|^Отозвать$/i}).click()
    await owner.getByRole('button',{name:/Send pending operations|Отправить ожидающие операции/i}).click()
    await recipient.getByRole('button',{name:/Refresh permissions|Обновить права/i}).click()
    await expect(recipient.locator('.recipient-preview')).toHaveCount(0,{timeout:30000})
    await expect(recipient.getByRole('alert')).toContainText(
      /not enabled|revoked|отозван|не включён/i,{timeout:30000})
  }finally{
    await ownerContext.close()
    await recipientContext.close()
    await browser.close()
  }
})
