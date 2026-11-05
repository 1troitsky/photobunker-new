import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const origin = process.env.LOCAL_APP_URL ?? 'http://127.0.0.1:18081'
const output = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/private/tmp/photobunker-public-shell'
const url = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('public_shell_check_requires_loopback')

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const runtimeErrors = [], failedRequests = []
page.on('pageerror', error => runtimeErrors.push(error.message))
page.on('requestfailed', request => failedRequests.push(new URL(request.url()).pathname))

try {
  const started = performance.now()
  await page.goto(`${origin}/welcome`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'PhotoBunker', exact: true })).toBeVisible()
  const shellMs = Math.round(performance.now() - started)
  await expect(page.getByRole('link', { name: /Create new account/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Recover account/i })).toBeVisible()
  const desktop = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  expect(desktop.document).toBeLessThanOrEqual(desktop.viewport + 1)
  await page.screenshot({ path: `${output}/welcome-desktop.png`, fullPage: true, animations: 'disabled' })

  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  expect(mobile.document).toBeLessThanOrEqual(mobile.viewport + 1)
  await page.screenshot({ path: `${output}/welcome-mobile.png`, fullPage: true, animations: 'disabled' })

  await page.getByRole('link', { name: /Create new account/i }).click()
  await expect(page).toHaveURL(/\/profile\/account\?mode=create/)
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
  expect(runtimeErrors).toEqual([])
  expect(failedRequests).toEqual([])
  console.log(JSON.stringify({ publicShell: 'pass', shellMs, desktop, mobile, runtimeErrors, failedRequests, output }))
} finally {
  await context.close()
  await browser.close()
}
