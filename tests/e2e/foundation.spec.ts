import { expect, test } from '@playwright/test'

test('serves the built production UI welcome and retains the foundation diagnostic', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('PhotoBunker')
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByRole('heading', { name: 'PhotoBunker' })).toBeVisible()

  await page.goto('/foundation')
  await expect(page.getByTestId('foundation')).toBeVisible()
  await expect(page.getByText('Legacy runtime')).toBeVisible()
  await expect(page.getByText('excluded')).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Foundation preview' })).toBeVisible()
})

test('serves install metadata and exact old owner icons in production preview', async ({ page }) => {
  await page.goto('/welcome')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()
  const response = await page.request.get(manifestHref!)
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({
    name: 'PhotoBunker',
    start_url: '/welcome',
  })
  for (const asset of [
    '/favicon.svg', '/favicon-96x96.png', '/favicon.ico',
    '/apple-touch-icon.png', '/web-app-manifest-192x192.png',
    '/web-app-manifest-512x512.png', '/icons/brand-logo.png',
  ]) {
    expect((await page.request.get(asset)).ok(), asset).toBe(true)
  }
})
