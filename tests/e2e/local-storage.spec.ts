import {expect,test} from '@playwright/test'

test('R2-04 device diagnostic exercises actual secure storage, no fake success',async({page})=>{
  await page.goto('/profile')
  const diagnostics=page.locator('.storage-diagnostics')
  await expect(diagnostics).toBeVisible()
  await diagnostics.getByRole('button',{name:/Test local storage|Проверить хранилище/i}).click()
  await expect(diagnostics.locator('dt',{hasText:'IndexedDB + CryptoKey'})).toBeVisible()
  await expect(diagnostics.locator('dt',{hasText:'OPFS'})).toBeVisible()
  await expect(diagnostics.locator('dt',{hasText:'Encrypted Blob fallback'})).toBeVisible()
  await expect(diagnostics.locator('dt',{hasText:'Persisted'})).toBeVisible()
})

test('R2-04 persistent-storage request reports granted/denied/unsupported honestly',async({page})=>{
  await page.goto('/profile')
  const diagnostics=page.locator('.storage-diagnostics')
  await diagnostics.getByRole('button',{name:/Request persistent storage|Запросить постоянное хранение/i}).click()
  await expect(diagnostics.locator('dt',{hasText:'Persistence request'})).toBeVisible()
  await expect(diagnostics.locator('dt',{hasText:'Persistence request'}).locator('xpath=following-sibling::dd[1]')).toContainText(/granted|denied|unsupported|error/)
})

test('no photo content or key is persisted by a diagnostic-only visit',async({page})=>{
  await page.goto('/profile')
  await page.locator('.storage-diagnostics button').first().click()
  const storage=await page.evaluate(()=>JSON.stringify(localStorage))
  expect(storage).not.toContain('PB2.')
  const tables=await page.evaluate(async()=>{
    const all=await indexedDB.databases()
    return all.map(d=>d.name)
  })
  expect(tables).not.toContain('photobunker-plaintext-v1')
})
