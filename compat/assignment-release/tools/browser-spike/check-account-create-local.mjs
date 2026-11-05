import { chromium, expect } from '@playwright/test'

const origin = process.env.LOCAL_APP_URL ?? 'http://127.0.0.1:18081'
const parsed = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  throw new Error('account_create_requires_loopback_origin')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  locale: 'ru-RU',
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()
const runtimeErrors = []
page.on('pageerror', error => runtimeErrors.push(error.name))

let stage = 'open'
try {
  await page.goto(`${origin}/profile/account`, { waitUntil: 'domcontentloaded' })

  stage = 'prepare-key'
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  const keyField = page.getByLabel('Ключ аккаунта', { exact: true })
  await expect(keyField).toBeVisible()
  const recoveryKey = await keyField.inputValue()
  expect(recoveryKey.length).toBeGreaterThan(40)

  stage = 'confirm-key'
  await page.getByLabel('Я сохранил ключ восстановления', { exact: true }).check()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/profile`, { timeout: 45_000 })

  stage = 'authenticated-session'
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/v1/identity/me', {
      credentials: 'same-origin',
      headers: { 'X-PhotoBunker': 'identity-v1' },
    })
    const payload = await response.json().catch(() => ({}))
    return {
      status: response.status,
      hasAccount: typeof payload?.account?.id === 'string',
      hasDevice: typeof payload?.deviceId === 'string',
    }
  })
  expect(session).toEqual({ status: 200, hasAccount: true, hasDevice: true })
  expect(runtimeErrors).toEqual([])

  console.log(JSON.stringify({
    accountCreate: 'pass',
    origin: parsed.origin,
    authenticatedSession: 'pass',
    runtimeErrors: 0,
  }))
} catch (error) {
  throw new Error(`account_create_${stage}: ${error instanceof Error ? error.name : 'unknown'}`)
} finally {
  await context.close()
  await browser.close()
}
