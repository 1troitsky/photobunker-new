import {chromium,expect,test} from '@playwright/test'

/**
 * Codex production milestone gate. Requires the deployed HTTPS SPA+same-origin
 * Laravel Identity API; never runs against a Vite dev server or anonymous demo.
 * Usage: PB_CAMERA_HTTPS_ORIGIN=https://staging.example.com pnpm exec playwright test camera-production
 * No physical-phone guarantees; owner iPhone/Android B1 remains separate.
 */
const origin=process.env.PB_CAMERA_HTTPS_ORIGIN
test.skip(!origin,'R2-06: requires Codex production HTTPS preview with Identity v2 backend')

test('real synthetic camera -> three encrypted local commits -> viewer -> reload -> offline unlock',async()=>{
  const browser=await chromium.launch({args:[
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  ]})
  const context=await browser.newContext({baseURL:origin,permissions:['camera']})
  const page=await context.newPage()
  const remotePhotoRequests:string[]=[]
  page.on('request',r=>{if(/\/(?:api\/photos|garage|s3|_matrix)\b/i.test(r.url()))
    remotePhotoRequests.push(r.url())})
  try{
    await page.goto('/account/create')
    await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
    const key=await page.locator('#identity-key').inputValue()
    expect(key).toMatch(/^PB2\./)
    await page.locator('input[type=checkbox]').check()
    await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
    await expect(page).toHaveURL(/\/profile$/,{timeout:30_000})
    await page.goto('/camera')
    await expect(page.getByTestId('production-camera')).toBeVisible()
    await page.getByRole('button',{name:/Enable camera|Включить камеру/i}).click()
    await expect(page.getByRole('button',{name:/Take photo|Снять фото/i})).toBeEnabled()
    await page.getByRole('button',{name:/Revalidate server time|Проверить время сервера/i}).click()
    const ids:string[]=[]
    for(let n=0;n<3;n++){
      await page.getByRole('button',{name:/Take photo|Снять фото/i}).click()
      await expect(page.getByText(/Encrypted on this device|Сохранено зашифрованно/i)).toBeVisible({timeout:30_000})
      const href=await page.getByRole('button',{name:/Open photo|Открыть снимок/i}).count()
      expect(href).toBe(1)
    }
    await page.goto('/photos')
    const photos=page.locator('.secure-photo-row')
    await expect(photos).toHaveCount(3,{timeout:30_000})
    for(const href of await photos.evaluateAll(elements=>elements.map(el=>el.getAttribute('href')))){
      expect(href).toMatch(/^\/photos\/[a-z0-9-]+$/)
      ids.push(href!)
    }
    expect(new Set(ids).size).toBe(3)
    await photos.first().click()
    await expect(page.locator('[data-testid=local-photo-viewer] img')).toBeVisible({timeout:30_000})
    await page.reload()
    await expect(page.locator('[data-testid=local-photo-viewer] img')).toBeVisible({timeout:30_000})
    await page.evaluate(()=>navigator.serviceWorker.ready)
    await context.setOffline(true)
    await page.reload()
    // R2-03 may require explicit offline device unlock after a cold reload.
    await page.goto('/profile')
    const offline=page.getByRole('button',{name:/Unlock local data offline|Открыть локально без сети/i}).first()
    await offline.click()
    // Keep the in-memory offline unlock while navigating through the SPA. A full
    // document navigation intentionally clears decrypted identity state.
    await page.getByRole('link',{name:/Photos|Фото/i}).click()
    await page.locator(`a[href="${ids[0]}"]`).click()
    await expect(page.locator('[data-testid=local-photo-viewer] img')).toBeVisible({timeout:30_000})
    expect(remotePhotoRequests).toEqual([])
    // no save-to-download or user-visible file input as capture fallback
    expect(await page.locator('input[type=file],a[download]').count()).toBe(0)
  }finally{await context.close();await browser.close()}
})

test('denied real permission shows error and never marks a saved capture',async()=>{
  const browser=await chromium.launch({args:['--use-fake-device-for-media-stream']})
  const context=await browser.newContext({baseURL:origin,permissions:[]})
  const page=await context.newPage()
  try{
    await page.goto('/account/create')
    await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
    await page.locator('input[type=checkbox]').check()
    await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
    await expect(page).toHaveURL(/\/profile$/,{timeout:30_000})
    await page.goto('/camera')
    await page.getByRole('button',{name:/Enable camera|Включить камеру/i}).click()
    await expect(page.getByRole('alert')).toContainText(/denied|запрещён|supported|поддерж|NotAllowed/i)
    await expect(page.getByRole('button',{name:/Take photo|Снять фото/i})).toBeDisabled()
    await page.goto('/photos')
    await expect(page.locator('.secure-photo-row')).toHaveCount(0)
  }finally{await context.close();await browser.close()}
})
