import {test,expect} from '@playwright/test'

/**
 * Requires the real production HTTPS UI + PB2 Identity API + PostgreSQL.
 * This is not marked PASS without Codex running it on staging.
 */
const origin=process.env.PB_ASSIGNMENTS_HTTPS_ORIGIN


test('local-first encrypted create / offline reload / sync / edit / transition / duplicate / delete',async({browser})=>{
  test.skip(!origin,'R2-08: requires production HTTPS Identity+PostgreSQL staging')
  const context=await browser.newContext({baseURL:origin})
  const page=await context.newPage()
  try{
    await page.goto('/account/create')
    await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
    await page.locator('input[type=checkbox]').check()
    await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
    await expect(page).toHaveURL(/\/profile$/,{timeout:30000})
    await page.goto('/assignments')
    await expect(page.getByTestId('real-assignments')).toBeVisible()
    await page.evaluate(()=>navigator.serviceWorker.ready)
    await context.setOffline(true)
    await page.goto('/assignments/new')
    await page.getByRole('textbox',{name:/^Title$|^Название$/i}).fill('Encrypted secret assignment')
    await page.getByRole('textbox',{name:/Instructions|Инструкции/i}).fill('Private notes never in IndexedDB plaintext')
    await page.getByRole('button',{name:/^Save$|^Сохранить$/i}).click()
    await expect(page.locator('.assignment-detail h2')).toHaveText('Encrypted secret assignment')
    const detail=page.url()
    await page.reload()
    await expect(page.locator('.assignment-detail h2')).toHaveText('Encrypted secret assignment')
    const stored=await page.evaluate(async()=>{
      return await new Promise<string>((resolve,reject)=>{
        const request=indexedDB.open('photobunker-assignments-encrypted-v1')
        request.onerror=()=>reject(request.error)
        request.onsuccess=()=>{
          const db=request.result,tx=db.transaction(['assignments','operations'],'readonly')
          const values:string[]=[]
          for(const name of ['assignments','operations']){
            const q=tx.objectStore(name).getAll()
            q.onsuccess=()=>values.push(JSON.stringify(q.result))
          }
          tx.oncomplete=()=>{db.close();resolve(values.join(' '))}
          tx.onerror=()=>reject(tx.error)
        }
      })
    })
    expect(stored).not.toContain('Encrypted secret assignment')
    expect(stored).not.toContain('Private notes never')
    await context.setOffline(false)
    await page.getByRole('button',{name:/Sync now|Синхронизировать/i}).count()
    await page.goto('/assignments')
    await page.getByRole('button',{name:/Sync now|Синхронизировать/i}).click()
    await expect(page.locator('.assignment-item').first()).toContainText(/Synced|Синхронизировано/,{timeout:60000})
    await page.goto(new URL(detail).pathname+'/edit')
    await page.getByRole('textbox',{name:/^Title$|^Название$/i}).fill('Edited assignment')
    await page.getByRole('button',{name:/^Save$|^Сохранить$/i}).click()
    await expect(page.locator('.assignment-detail h2')).toHaveText('Edited assignment')
    await page.getByRole('button',{name:/In progress|В работе/i}).click()
    await expect(page.locator('.assignment-detail')).toContainText(/In progress|В работе/)
    await page.getByRole('button',{name:/Duplicate|Дублировать/i}).click()
    await expect(page.locator('.assignment-detail')).toContainText('Edited assignment')
    await page.getByRole('button',{name:/Delete|Удалить/i}).click({force:true})
    await expect(page).toHaveURL(/\/assignments$/)
    await page.reload()
    await expect(page.locator('.assignment-item')).toHaveCount(1)
  }finally{await context.close()}
})

test('anonymous assignment list exposes no fixture-backed assignments',async({page})=>{
  await page.goto('/assignments')
  await expect(page.getByTestId('real-assignments')).toBeVisible()
  await expect(page.locator('.assignment-item')).toHaveCount(0)
  await expect(page.getByRole('link',{name:/Create account|Создать аккаунт/i})).toBeVisible()
})
