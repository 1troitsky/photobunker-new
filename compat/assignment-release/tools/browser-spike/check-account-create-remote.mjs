import { chromium, expect } from '@playwright/test'

const origin = process.env.REMOTE_APP_URL
if (!origin || new URL(origin).protocol !== 'https:')
  throw new Error('remote_https_origin_required')
if (process.env.CONFIRM_REMOTE_ACCOUNT_CREATE !== 'yes')
  throw new Error('remote_account_creation_not_confirmed')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 390, height: 844 },
})
const page = await context.newPage()
const runtimeErrors = []
page.on('pageerror', error => runtimeErrors.push(`${error.name}: ${error.message}`))

try {
  await page.goto(`${origin}/profile/account?mode=create&from=welcome`, {
    waitUntil: 'domcontentloaded',
  })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  const keyField = page.getByLabel('Account key', { exact: true })
  await expect(keyField).toBeVisible()
  expect((await keyField.inputValue()).length).toBeGreaterThan(40)
  await page.getByLabel('I saved the recovery key', { exact: true }).check()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/profile`, { timeout: 45_000 })

  const session = await page.evaluate(async () => {
    const response = await fetch('/api/v1/identity/me', {
      credentials: 'same-origin',
      headers: { 'X-PhotoBunker': 'identity-v1' },
    })
    const payload = await response.json().catch(() => ({}))
    return {
      status: response.status,
      userId: payload?.account?.userId,
      hasAccount: typeof payload?.account?.id === 'string',
      hasDevice: typeof payload?.deviceId === 'string',
    }
  })
  expect(session.status).toBe(200)
  expect(session.hasAccount).toBe(true)
  expect(session.hasDevice).toBe(true)
  expect(session.userId).toMatch(/^\d{8}$/)
  expect(runtimeErrors).toEqual([])
  await page.screenshot({
    path: '/private/tmp/photobunker-remote-account.png',
    fullPage: true,
  })
  console.log(JSON.stringify({
    accountCreate: 'pass',
    origin,
    userId: session.userId,
    runtimeErrors: runtimeErrors.length,
  }))
} finally {
  await context.close()
  await browser.close()
}
