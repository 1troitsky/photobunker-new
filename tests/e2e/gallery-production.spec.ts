import {test,expect} from '@playwright/test'
/** Real HTTPS + PB2 Identity + PostgreSQL + private Garage required. Not a mock PASS. */
const url=process.env.PB_GALLERY_HTTPS_ORIGIN
test.skip(!url,'Codex must provide production HTTPS with Garage and database')
test('R2-07 offline gallery, WebP thumbnail, NAME-ID, title revision and cloud refresh',async({browser})=>{
 const context=await browser.newContext({baseURL:url,permissions:['camera']})
 const page=await context.newPage()
 try{
   await page.goto('/account/create')
   await page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click()
   await page.locator('input[type=checkbox]').check()
   await page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i}).click()
   await expect(page).toHaveURL(/\/profile$/,{timeout:30000})
   await page.goto('/camera')
   await page.getByRole('button',{name:/Enable camera|Включить камеру/i}).click()
   await page.getByRole('button',{name:/Take photo|Снять фото/i}).click()
   await expect(page.getByText(/Encrypted on this device|Сохранено зашифрованно/i)).toBeVisible({timeout:30000})
   await page.goto('/photos')
   await expect(page.locator('.gallery-item')).toHaveCount(1)
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
 }finally{await context.close()}
})
