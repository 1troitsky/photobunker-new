import { expect, test } from '@playwright/test'

test.skip(!process.env.PHOTOBUNKER_IDENTITY_E2E, 'requires the local Laravel Identity API')

test('R2-03 live create, logout, recovery and durable offline sign-out', async ({ page, context }) => {
  await page.goto('/account/create')
  await page.getByRole('button', { name: /Generate Recovery Key|Создать ключ восстановления/i }).click()
  const key = await page.locator('#identity-key').inputValue()
  expect(key).toMatch(/^PB2\./)
  await page.locator('input[type=checkbox]').check()
  await page.getByRole('button', { name: /Confirm and create|Подтвердить и создать/i }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('identity-authenticated')).toBeVisible()

  await page.getByRole('button', { name: /Sign out|Выйти/i }).click()
  await expect(page.getByText(/No anonymous account unlocked|Анонимный аккаунт пока не открыт/i)).toBeVisible()

  await page.goto('/account/restore')
  await page.locator('#identity-key').fill(key)
  await page.getByRole('button', { name: /Restore account|Восстановить аккаунт/i }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('identity-authenticated')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('identity-authenticated')).toBeVisible()

  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)))
    .toBe(true)
  await context.setOffline(true)
  await page.getByRole('button', { name: /Sign out|Выйти/i }).click()
  await expect(page.getByText(/No anonymous account unlocked|Анонимный аккаунт пока не открыт/i)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(/No anonymous account unlocked|Анонимный аккаунт пока не открыт/i)).toBeVisible()
  await context.setOffline(false)
})
