import {chromium,test,expect} from '@playwright/test'
/** Real HTTPS + PB2 Identity + PostgreSQL + private Garage required. Not a mock PASS. */
const url=process.env.PB_GALLERY_HTTPS_ORIGIN
test.skip(!url,'Codex must provide production HTTPS with Garage and database')
test.setTimeout(90_000)
test('R2-07 offline gallery, WebP thumbnail, NAME-ID, title revision and cloud refresh',async()=>{
 const browser=await chromium.launch({args:[
   '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
 ]})
 const context=await browser.newContext({baseURL:url,permissions:['camera']})
 const page=await context.newPage()
 let recoveryContext:Awaited<ReturnType<typeof browser.newContext>>|null=null
 try{
   await page.goto('/account/create')
   await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
   const recoveryKey=await page.locator('#identity-key').inputValue()
   await page.locator('input[type=checkbox]').check()
   await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
   await expect(page).toHaveURL(/\/profile$/,{timeout:30000})
   await page.goto('/camera')
   await page.getByRole('button',{name:/Enable camera|Включить камеру/i}).click()
   await page.getByRole('button',{name:/Take photo|Снять фото/i}).click()
   await expect(page.getByText(/Encrypted on this device|Сохранено зашифрованно/i)).toBeVisible({timeout:30000})
   await page.goto('/photos')
   await expect(page.locator('.gallery-item')).toHaveCount(1)
   const localThumbnail=page.locator('.gallery-thumb-image').first()
   await expect(localThumbnail).toBeVisible()
   const thumbnail=await localThumbnail.evaluate(image=>{
     const element=image as HTMLImageElement
     return{source:element.currentSrc,width:element.naturalWidth,height:element.naturalHeight}
   })
   expect(thumbnail.source).toMatch(/^blob:/)
   expect(Math.max(thumbnail.width,thumbnail.height)).toBeLessThanOrEqual(320)
   await page.getByRole('button',{name:/Edit title|Изменить название/i}).first().click()
   await page.locator('.gallery-editor input').fill('Private museum photo')
   await page.getByRole('button',{name:/^Save$|^Сохранить$/i}).click()
   await expect(page.getByText('Private museum photo')).toBeVisible()
   await page.reload()
   await expect(page.getByText('Private museum photo')).toBeVisible()
   await page.getByRole('button',{name:/Sync now|Синхронизировать/i}).click()
   await expect(page.getByText(/Cloud verified|В облаке/).first()).toBeVisible({timeout:60000})
   const display=await page.locator('.gallery-item small').first().textContent()
   expect(display).toMatch(/^[A-Z]{4}[0-9]{4}$/)
   await page.getByRole('button',{name:/Grid|Сетка/i}).click()
   await page.getByRole('button',{name:/List|Список/i}).click()
   await expect(page.locator('.gallery-items.list')).toBeVisible()

   // A newly trusted device starts with an empty IndexedDB and obtains only
   // authorized ciphertext/headers from the server.
   recoveryContext=await browser.newContext({baseURL:url})
   const recovered=await recoveryContext.newPage()
   await recovered.goto('/account/restore')
   await recovered.locator('#identity-key').fill(recoveryKey)
   await recovered.getByRole('button',{name:/Restore account|Восстановить аккаунт/i}).click()
   await expect(recovered).toHaveURL(/\/profile$/,{timeout:30_000})
   await recovered.goto('/photos')
   await expect(recovered.locator('.gallery-item')).toHaveCount(1)
   await expect(recovered.getByText('Private museum photo')).toBeVisible({timeout:30_000})
   await expect(recovered.locator('.gallery-thumb-image').first()).toBeVisible({timeout:30_000})
   await expect(recovered.locator('.gallery-item small').first()).toHaveText(/^[A-Z]{4}[0-9]{4}$/)

   // The first device still opens its encrypted read model after cold offline
   // reload and explicit local unlock; no network fallback is required.
   await page.evaluate(()=>navigator.serviceWorker.ready)
   await context.setOffline(true)
   await page.reload()
   await page.goto('/profile')
   await page.getByRole('button',{name:/Unlock local data offline|Открыть локально без сети/i}).click()
   await page.getByRole('link',{name:/Photos|Фото/i}).click()
   await expect(page.getByText('Private museum photo')).toBeVisible()
   await expect(page.locator('.gallery-thumb-image').first()).toBeVisible()
 }finally{
   if(recoveryContext)await recoveryContext.close()
   await context.close();await browser.close()
 }
})
