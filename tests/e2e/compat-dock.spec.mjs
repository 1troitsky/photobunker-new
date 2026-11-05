import { expect, test } from '@playwright/test'

const compatUrl = process.env.PLAYWRIGHT_COMPAT_URL

test('Q1 dock keeps five readable destinations at the viewport bottom', async ({ page }) => {
  test.skip(!compatUrl, 'Set PLAYWRIGHT_COMPAT_URL to the compatibility Vite gateway')

  await page.goto(new URL('/assignments', compatUrl).href)

  // The local API can be unavailable during layout checks. This fixture lives
  // only in the browser process and does not create an account or write keys.
  await page.evaluate(async () => {
    const identity = await import('/src/identity/store.ts')
    const lock = await import('/src/app/lock.ts')
    identity.account.value = {
      id: 'q1-dock-layout-fixture', publicId: 'Q1FIXTURE', revision: 0,
      fields: { avatar: '', name: '', username: '', email: '', phone: '', links: '', about: '' },
      visibility: {
        avatar: 'private', name: 'private', username: 'private', email: 'private',
        phone: 'private', links: 'private', about: 'private',
      },
      matrix: { state: 'pending', userId: null },
    }
    identity.sessionState.value = 'authenticated'
    lock.appLockReady.value = true
    lock.appLocked.value = false
  })

  const dock = page.getByTestId('app-dock')
  await expect(dock).toBeVisible()
  await expect(dock.locator('.nav-item')).toHaveCount(5)

  for (const [width, height] of [[320, 700], [375, 812], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height })
    const layout = await dock.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const items = [...element.querySelectorAll('.nav-item')]
      return {
        bottom: rect.bottom,
        minWidth: Math.min(...items.map(item => item.getBoundingClientRect().width)),
        minHeight: Math.min(...items.map(item => item.getBoundingClientRect().height)),
        clipped: items.filter(item => item.lastElementChild.scrollWidth > item.lastElementChild.clientWidth).length,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
    expect(layout.bottom).toBe(height)
    expect(layout.minWidth).toBeGreaterThanOrEqual(44)
    expect(layout.minHeight).toBeGreaterThanOrEqual(44)
    expect(layout.clipped).toBe(0)
    expect(layout.overflow).toBe(false)
  }

  await page.setViewportSize({ width: 320, height: 700 })
  await expect(dock.locator('[aria-current="page"]')).toHaveCount(1)
  await dock.locator('a[href="/people"]').click()
  await expect(page).toHaveURL(/\/people$/)
  await expect(dock.locator('[aria-current="page"]')).toHaveAttribute('href', '/people')
  await dock.locator('a[href="/camera"]').click()
  await expect(page).toHaveURL(/\/camera$/)
  await expect(dock.locator('[aria-current="page"]')).toHaveAttribute('href', '/camera')
  await expect(dock.locator('.dock-camera')).toHaveCount(0)

  await dock.locator('a').first().focus()
  await page.keyboard.press('Tab')
  await expect(dock.locator('a').nth(1)).toBeFocused()
  expect(await dock.locator('a').nth(1).evaluate(element => element.matches(':focus-visible'))).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await dock.locator('a').first().evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')
})
