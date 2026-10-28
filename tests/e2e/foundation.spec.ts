import { expect, test } from '@playwright/test'

test('serves the built production foundation and survives reload', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('PhotoBunker')
  await expect(page.getByTestId('foundation')).toBeVisible()
  await expect(page.getByText('Legacy runtime')).toBeVisible()
  await expect(page.getByText('excluded')).toHaveCount(2)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Foundation preview' })).toBeVisible()
})

test('serves the PWA manifest from the production bundle', async ({ page }) => {
  await page.goto('/')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()

  const response = await page.request.get(manifestHref!)
  expect(response.ok()).toBe(true)
  await expect(response.json()).resolves.toMatchObject({ name: 'PhotoBunker' })
})
