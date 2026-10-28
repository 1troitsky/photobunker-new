import {chromium,expect,test} from '@playwright/test'
/** Real production HTTPS + Identity API + PostgreSQL + Garage required; never a mock PASS. */
const origin=process.env.PB_SYNC_HTTPS_ORIGIN
test.skip(!origin,'Codex must deploy HTTPS API + PostgreSQL + Garage and run integration with real storage')
test('R2-05 offline encrypted outbox survives reload, 503, lost receipt and readback',async()=>{
  const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
  const context=await browser.newContext({baseURL:origin,permissions:['camera']})
  const page=await context.newPage()
  try{
    await page.goto('/account/create')
    await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
    await page.locator('input[type=checkbox]').check()
    await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
    await expect(page).toHaveURL(/\/profile$/,{timeout:30000})
    await page.goto('/camera')
    await page.getByRole('button',{name:/Enable camera|Включить камеру/i}).click()
    await expect(page.getByRole('button',{name:/Take photo|Снять фото/i})).toBeEnabled()
    await page.route('**/photos/v1/**',route=>route.fulfill({status:503,body:'{}'}))
    await page.getByRole('button',{name:/Take photo|Снять фото/i}).click()
    await expect(page.getByText(/Encrypted on this device|Сохранено зашифрованно/i)).toBeVisible({timeout:30000})
    await page.goto('/photos')
    await expect(page.locator('.secure-photo-row')).toHaveCount(1)
    await expect(page.locator('.secure-local-label')).not.toContainText(/Cloud verified|В облаке/)
    await page.reload()
    await page.unroute('**/photos/v1/**')
    await page.getByRole('button',{name:/Sync now|Синхронизировать/i}).click()
    await expect(page.locator('.secure-local-label')).toContainText(/Cloud verified|В облаке/,{timeout:60000})
    const href=await page.locator('.secure-photo-row').first().getAttribute('href')
    const id=href!.split('/').pop()!
    const receipt=await page.evaluate(async id=>{
      const r=await fetch('/photos/v1/'+id+'/receipt',{credentials:'same-origin',cache:'no-store'})
      if(!r.ok)throw new Error('receipt_http_'+r.status)
      return r.json()
    },id) as {state:string;receipt:{assets:{assetId:string;sha256:string;bytes:number}[]}}
    expect(receipt.state).toBe('active')
    expect(receipt.receipt.assets).toHaveLength(2)
    const asset=receipt.receipt.assets[0]!
    const actual=await page.evaluate(async args=>{
      const r=await fetch('/photos/v1/'+args.id+'/objects/'+args.assetId,{credentials:'same-origin',cache:'no-store'})
      if(!r.ok)throw new Error('readback_http_'+r.status)
      const bytes=await r.arrayBuffer()
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
        .map(x=>x.toString(16).padStart(2,'0')).join('')
      return{sha,bytes:bytes.byteLength}
    },{id,assetId:asset.assetId})
    expect(actual).toEqual({sha:asset.sha256,bytes:asset.bytes})
    await page.goto(href!)
    await expect(page.locator('[data-testid=local-photo-viewer] img')).toBeVisible()
  }finally{await context.close();await browser.close()}
})
