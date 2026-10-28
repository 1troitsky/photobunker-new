import { expect, test } from '@playwright/test'

const routes = [
  '/welcome',
  '/account/create',
  '/account/restore',
  '/photos',
  '/camera',
  '/assignments',
  '/browser',
  '/profile',
  '/editor/preview',
  '/photo-card/preview',
  '/pin/preview',
]

test('all eleven preview routes render on production bundle, including after reload', async ({ page }) => {
  await page.goto('/welcome')
  for (const route of routes) {
    await page.goto(route)
    await expect(page.locator('body')).not.toContainText('404 Not Found')
    await expect(page.locator('body')).toContainText(/PhotoBunker|INTERFACE PREVIEW|ПРЕДПРОСМОТР ИНТЕРФЕЙСА/)
    await page.reload()
    await expect(page.locator('body')).not.toContainText('404 Not Found')
  }
})

test('anonymous Create/Restore use only PB2, never email/password fields', async ({ page }) => {
  await page.goto('/welcome')
  await page.getByRole('link', { name: /Create new account|Создать новый аккаунт/i }).click()
  await expect(page).toHaveURL(/\/account\/create$/)
  await expect(page.locator('input[type=email], input[type=password]')).toHaveCount(0)
  await expect(page.getByText(/Recovery Key|ключ восстановления/i).first()).toBeVisible()
  await page.getByRole('link', { name: /Restore access|Восстановить доступ/i }).click()
  await expect(page).toHaveURL(/\/account\/restore$/)
  await expect(page.locator('input[type=email], input[type=password]')).toHaveCount(0)
  await expect(page.locator('textarea')).toHaveCount(1)
})

test('dock navigates five primary screens with camera center and no messaging runtime', async ({ page }) => {
  await page.goto('/photos')
  const dock = page.getByTestId('app-dock')
  await expect(dock.locator('a')).toHaveCount(5)
  for (const path of ['/assignments','/browser','/camera','/photos','/profile']) {
    await dock.locator('a[href="' + path + '"]').click()
    await expect(page).toHaveURL(new RegExp(path + '$'))
  }
  await expect(dock.locator('a[href="/camera"]')).toHaveClass(/dock-camera/)
  await expect(dock).not.toContainText(/Messages|Сообщения|Chat/i)
})

test('photos filter and browser folder selection work without network or saving', async ({ page }) => {
  await page.goto('/photos')
  await expect(page.locator('.photo-tile')).toHaveCount(6)
  await page.getByRole('searchbox').fill('ABCD0001')
  await expect(page.locator('.photo-tile')).toHaveCount(1)
  await page.getByRole('searchbox').fill('this-does-not-exist')
  await expect(page.locator('.empty-state')).toBeVisible()
  await page.goto('/browser')
  await page.locator('.browser-sidebar .folder-row').nth(1).click()
  await expect(page.locator('.browser-gallery .photo-tile')).toHaveCount(2)
})

test('RU/EN, theme and 320px mobile safe-area layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 680 })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'RU', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Светлая', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('no photo/camera backend request in preview', async ({ page }) => {
  const endpoints: string[] = []
  page.on('request', request => {
    if (/\/api\/|\/_matrix\/|matrix\.|livekit/i.test(request.url())) endpoints.push(request.url())
  })
  await page.goto('/camera')
  await expect(page.getByRole('button', { name: /Capture unavailable|Съёмка недоступна/i })).toBeDisabled()
  await page.goto('/photos')
  await page.goto('/assignments')
  expect(endpoints).toEqual([])
})
