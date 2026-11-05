import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const origin = process.env.LOCAL_APP_URL ?? 'http://127.0.0.1:18081'
const output = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/private/tmp/photobunker-stage7'
const parsed = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  throw new Error('stage7_capture_requires_loopback_origin')

await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({ locale: 'ru-RU', viewport: { width: 390, height: 844 } })
await context.grantPermissions(['camera'], { origin: parsed.origin })
const page = await context.newPage()
const runtimeErrors = []
const failedRequests = []
const loadedDeferredAssets = []
const dialogs = []
const readiness = []
page.on('pageerror', error => runtimeErrors.push(error.message))
page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()}`))
page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept() })
page.on('response', response => {
  const path = new URL(response.url()).pathname
  if (/matrix_sdk|livekit|MessagesView/i.test(path)) loadedDeferredAssets.push(path)
})

async function timed(name, action, ready) {
  const started = performance.now()
  await action()
  await expect(ready).toBeVisible({ timeout: 60_000 })
  readiness.push({ name, ms: Math.round(performance.now() - started) })
}

async function shot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' })
}

async function encryptedCacheSummary() {
  return page.evaluate(async () => {
    const read = (database, key) => new Promise((resolve, reject) => {
      const transaction = database.transaction('entries')
      const request = transaction.objectStore('entries').get(key)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
    })
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('photobunker-encrypted-queue-v1')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const keys = await new Promise((resolve, reject) => {
      const transaction = database.transaction('entries')
      const request = transaction.objectStore('entries').getAllKeys()
      transaction.oncomplete = () => resolve(request.result.map(String))
      transaction.onerror = () => reject(transaction.error)
    })
    const indexKey = keys.find(key => key.startsWith('photo-index:'))
    if (!indexKey) { database.close(); return { keys, photos: -1 } }
    const scope = indexKey.slice('photo-index:'.length)
    const [wrapped, key] = await Promise.all([
      read(database, indexKey), read(database, `photo-cache-key:${scope}`),
    ])
    let photos = -2
    try {
      const clear = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: wrapped.iv,
        additionalData: new TextEncoder().encode(indexKey),
      }, key, wrapped.ciphertext)
      const value = JSON.parse(new TextDecoder().decode(clear))
      photos = Array.isArray(value) ? value.length : -3
    } catch { photos = -4 }
    database.close()
    return { keys, photos }
  })
}

async function openDock(label, path, ready) {
  await timed(path, async () => {
    await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(`${origin}${path}`, { timeout: 30_000 })
  }, ready)
}

try {
  await page.goto(`${origin}/profile/account`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  const key = page.getByLabel('Ключ аккаунта', { exact: true })
  await expect(key).toBeVisible({ timeout: 60_000 })
  expect((await key.inputValue()).length).toBeGreaterThan(40)
  await page.getByLabel('Я сохранил ключ восстановления', { exact: true }).check()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/profile`, { timeout: 60_000 })
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 60_000 })

  await page.goto(`${origin}/assignments`)
  await page.getByRole('button', { name: 'Новое задание', exact: true }).first().click()
  await page.getByLabel('Название', { exact: true }).fill('Коммерческая съёмка')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+$/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Снимать', exact: true }).first().click()
  await expect(page).toHaveURL(`${origin}/camera`)

  const enableCamera = page.getByRole('button', { name: 'Включить камеру', exact: true })
  const shutter = page.getByRole('button', { name: 'Снять фото', exact: true })
  await expect.poll(async () => {
    if (await shutter.isEnabled().catch(() => false)) return true
    if (await enableCamera.isEnabled().catch(() => false)) await enableCamera.click()
    return false
  }, { timeout: 60_000 }).toBe(true)
  for (let index = 0; index < 2; index++) {
    await shutter.click()
    await expect(page.getByText('Кадр сохранён в этом браузере', { exact: false }))
      .toBeVisible({ timeout: 60_000 })
    await expect.poll(() => shutter.isEnabled().catch(() => false), { timeout: 60_000 }).toBe(true)
  }
  await expect.poll(async () => (await encryptedCacheSummary()).photos, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2)

  await openDock('Задания', '/assignments', page.getByRole('heading', { name: 'Задания', exact: true }))
  await expect(page.getByText('Коммерческая съёмка', { exact: true })).toBeVisible({ timeout: 60_000 })
  await shot('01-assignments-mobile')

  await openDock('Браузер', '/browser', page.getByRole('heading', { name: 'Браузер', exact: true }))
  await expect.poll(() => page.locator('.browser-library-photo').count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2)
  const tile = page.locator('.browser-library-photo').first()
  await expect(tile).toBeVisible({ timeout: 60_000 })
  await shot('02-browser-mobile')

  await timed('photo', () => tile.click(), page.locator('.photo-view-stage img'))
  await shot('03-photo-mobile')
  await timed('photo-card', () => page.getByRole('button', { name: 'Карточка', exact: true }).click(), page.locator('.photo-card-intro'))
  await expect(page.locator('.photo-card-image img')).toBeVisible({ timeout: 60_000 })
  await shot('04-photo-card-mobile')

  await openDock('Контакты', '/people', page.getByRole('heading', { name: 'Команды и контакты', exact: true }))
  await page.getByRole('button', { name: 'Создать команду', exact: true }).first().click()
  const teamDialog = page.getByRole('dialog', { name: 'Создать команду', exact: true })
  await teamDialog.getByLabel('Название', { exact: true }).fill('Команда фотографов')
  await teamDialog.getByLabel('Описание', { exact: true }).fill('Рабочая команда коммерческой съёмки')
  await teamDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page).toHaveURL(/\/profile\/teams\/[0-9a-f-]+$/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Команда фотографов', exact: true })).toBeVisible({ timeout: 60_000 })
  await shot('05-team-mobile')

  await page.goto(`${origin}/people`)
  await expect(page.getByText('Команда фотографов', { exact: true })).toBeVisible({ timeout: 60_000 })
  await shot('06-people-mobile')

  await openDock('Профиль', '/profile', page.getByRole('heading', { name: 'Профиль', exact: true }))
  await expect(page.getByText('Доступно только локальное содержимое', { exact: false })).toHaveCount(0)
  const identityStatus = await page.evaluate(async () =>
    (await fetch('/api/v1/identity/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-PhotoBunker': 'identity-v1' },
    })).status,
  )
  expect(identityStatus).toBe(200)
  await shot('07-profile-mobile')
  await page.goto(`${origin}/profile/security`)
  await expect(page.getByRole('heading', { name: 'Безопасность', exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.security-overview')).toBeVisible()
  await shot('08-security-mobile')
  await page.goto(`${origin}/status`)
  await expect(page.getByRole('heading', { name: 'Статус', exact: true })).toBeVisible({ timeout: 60_000 })
  await shot('09-status-mobile')

  const cacheBeforeReload = await encryptedCacheSummary()

  await page.setViewportSize({ width: 1440, height: 900 })
  const reloadStarted = performance.now()
  await page.goto(`${origin}/browser`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Браузер', exact: true })).toBeVisible({ timeout: 60_000 })
  readiness.push({ name: 'browser-reload-shell', ms: Math.round(performance.now() - reloadStarted) })
  const reloadedPhoto = page.locator('.browser-library-photo').first()
  try { await expect(reloadedPhoto).toBeVisible({ timeout: 15_000 }) }
  catch (error) {
    console.error(JSON.stringify({
      reloadDiagnostic: true,
      cacheBeforeReload,
      cacheAfterReload: await encryptedCacheSummary(),
      body: (await page.locator('body').innerText()).slice(0, 3000),
    }))
    throw error
  }
  readiness.push({ name: 'browser-reload-photos', ms: Math.round(performance.now() - reloadStarted) })
  await shot('10-browser-desktop')
  const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)

  const navigation = await page.getByRole('navigation').getByRole('link').allTextContents()
  expect(navigation).toEqual(['Задания', 'Браузер', 'Камера', 'Контакты', 'Профиль'])
  expect(runtimeErrors).toEqual([])
  expect(dialogs).toEqual([])
  expect(loadedDeferredAssets).toEqual([])
  console.log(JSON.stringify({
    visual: 'pass', output, navigation, readiness, runtimeErrors,
    failedRequests, loadedDeferredAssets, dialogs, layout, identityStatus,
    cachePhotoCount: cacheBeforeReload.photos,
    cacheKeys: cacheBeforeReload.keys.filter(key => key.startsWith('photo-index:') || key.startsWith('photo-thumb:')),
  }))
} finally {
  await context.close()
  await browser.close()
}
