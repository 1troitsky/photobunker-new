import { expect, test } from '@playwright/test'

test('R2-03 capability probe and PB2 generation happen before any account POST',async({page})=>{
  const prepared:string[]=[]
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/identity/v2/prepare'))prepared.push(r.url())})
  await page.goto('/account/create')
  await expect(page.locator('input[type=password],input[type=email]')).toHaveCount(0)
  const generate=page.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i})
  await generate.click()
  await expect(page.locator('#identity-key')).toHaveValue(/^PB2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  expect(prepared).toEqual([])
  await expect(page.getByRole('button',{name:/Confirm and create|Подтвердить и создать/i})).toBeDisabled()
  await page.reload()
  await expect(page.getByText(/unfinished registration|незавершённое создание/i)).toBeVisible()
})

test('R2-03 restored key is not included in browser URLs or app localStorage',async({page})=>{
  await page.goto('/account/restore')
  const raw='PB2.AAECAwQFBgcICQoLDA0ODw.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8.DfSeedbBq6Y'
  await page.locator('#identity-key').fill(raw)
  const url=page.url()
  expect(url).not.toContain(raw)
  const stored=await page.evaluate(()=>JSON.stringify(localStorage))
  expect(stored).not.toContain(raw)
  await expect(page.locator('input[type=password],input[type=email]')).toHaveCount(0)
})

test('R2-03 concurrent tabs reserve exactly one pending account',async({context})=>{
  const first=await context.newPage(),second=await context.newPage()
  await Promise.all([first.goto('/account/create'),second.goto('/account/create')])
  await Promise.all([
    first.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click(),
    second.getByRole('button',{name:/Generate Recovery Key|Создать ключ восстановления/i}).click(),
  ])
  async function generatedKey(page:typeof first):Promise<string>{
    const input=page.locator('#identity-key')
    return await input.count()===1?input.inputValue():''
  }
  const values=await Promise.all([
    generatedKey(first),
    generatedKey(second),
  ])
  expect(values.filter(value=>value.startsWith('PB2.'))).toHaveLength(1)
  expect(await first.getByRole('alert').count()+await second.getByRole('alert').count()).toBe(1)
})
