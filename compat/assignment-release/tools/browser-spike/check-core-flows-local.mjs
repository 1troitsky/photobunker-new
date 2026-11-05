import { chromium, expect } from '@playwright/test'

const origin = process.env.LOCAL_APP_URL ?? 'http://127.0.0.1:18081'
const parsed = new URL(origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
  throw new Error('core_flows_require_loopback_origin')

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const runtimeErrors = []

async function createAccount(page) {
  await page.goto(`${origin}/profile/account`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click()
  const keyField = page.getByLabel('Ключ аккаунта', { exact: true })
  await expect(keyField).toBeVisible()
  const recoveryKey = await keyField.inputValue()
  expect(recoveryKey.length).toBeGreaterThan(40)
  await page.getByLabel('Я сохранил ключ восстановления', { exact: true }).check()
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/profile`, { timeout: 45_000 })
  return recoveryKey
}

async function expectAuthenticated(page) {
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
}

async function encryptedJobs(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('photobunker-encrypted-queue-v1', 1)
    request.onerror = () => resolve([])
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('entries')
      const keys = transaction.objectStore('entries').getAllKeys()
      const values = transaction.objectStore('entries').getAll()
      transaction.oncomplete = () => {
        const jobs = keys.result.map((key, index) => ({ key: String(key), value: values.result[index] }))
          .filter(row => row.key.startsWith('job:'))
          .map(row => ({ id: row.value.id, received: row.value.received === true }))
        database.close()
        resolve(jobs)
      }
      transaction.onabort = () => { database.close(); resolve([]) }
    }
  }))
}

const primary = await browser.newContext({
  locale: 'ru-RU',
  viewport: { width: 390, height: 844 },
})
await primary.grantPermissions(['camera'], { origin: parsed.origin })
const page = await primary.newPage()
page.on('pageerror', error => runtimeErrors.push(`primary:${error.name}`))

let stage = 'account-create'
try {
  const recoveryKey = await createAccount(page)
  await expectAuthenticated(page)

  stage = 'account-recovery'
  const recovered = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 390, height: 844 },
  })
  const recoveredPage = await recovered.newPage()
  recoveredPage.on('pageerror', error => runtimeErrors.push(`recovered:${error.name}`))
  await recoveredPage.goto(`${origin}/profile/account?mode=recover`, { waitUntil: 'domcontentloaded' })
  await recoveredPage.getByLabel('Ключ аккаунта', { exact: true }).fill(recoveryKey)
  await recoveredPage.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(recoveredPage).toHaveURL(`${origin}/profile`, { timeout: 45_000 })
  await expectAuthenticated(recoveredPage)
  await recovered.close()

  stage = 'assignment-create'
  await page.goto(`${origin}/assignments`)
  await page.getByRole('button', { name: 'Новое задание', exact: true }).first().click()
  await expect(page).toHaveURL(`${origin}/assignments/new`)
  await page.getByLabel('Название', { exact: true }).fill('QA Stage 6 assignment')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+$/, { timeout: 45_000 })
  const assignmentId = new URL(page.url()).pathname.split('/').at(-1)
  expect(assignmentId).toMatch(/^[0-9a-f-]{36}$/)

  stage = 'assignment-camera'
  await page.getByRole('button', { name: 'Снимать', exact: true }).first().click()
  await expect(page).toHaveURL(`${origin}/camera`)
  await expect(page.getByRole('button', { name: 'Проверить участников', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Подтвердить участников', exact: true })).toHaveCount(0)
  const enableCamera = page.getByRole('button', { name: 'Включить камеру', exact: true })
  const shutter = page.getByRole('button', { name: 'Снять фото', exact: true })
  try {
    await expect.poll(async () => {
      if (await shutter.isEnabled().catch(() => false)) return 'ready'
      if (await enableCamera.isEnabled().catch(() => false))
        await enableCamera.click()
      return 'starting'
    }, { timeout: 45_000 }).toBe('ready')
  } catch (error) {
    const cameraDiagnostics = await page.evaluate(() => ({
      alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent?.trim()).filter(Boolean),
      statuses: [...document.querySelectorAll('[role="status"]')].map(node => node.textContent?.trim()).filter(Boolean),
      feedback: [...document.querySelectorAll('.capture-feedback,.capture-note,.camera-message')].map(node => node.textContent?.trim()).filter(Boolean),
      video: [...document.querySelectorAll('video')].map(video => ({
        readyState: video.readyState,
        width: video.videoWidth,
        height: video.videoHeight,
      })),
    }))
    console.error(JSON.stringify({ cameraDiagnostics }))
    throw error
  }
  await shutter.click()
  try {
    await expect(page.getByText('Кадр сохранён в этом браузере', { exact: false }))
      .toBeVisible({ timeout: 45_000 })
  } catch (error) {
    const saveDiagnostics = await page.evaluate(async () => {
      const encryptedQueueKeys = await new Promise((resolve) => {
        const request = indexedDB.open('photobunker-encrypted-queue-v1', 1)
        request.onerror = () => resolve([])
        request.onsuccess = () => {
          const database = request.result
          const keys = database.transaction('entries').objectStore('entries').getAllKeys()
          keys.onerror = () => { database.close(); resolve([]) }
          keys.onsuccess = () => {
            database.close()
            resolve(keys.result.map(String).filter(key => key.startsWith('job:')))
          }
        }
      })
      return {
        alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent?.trim()).filter(Boolean),
        statuses: [...document.querySelectorAll('[role="status"]')].map(node => node.textContent?.trim()).filter(Boolean),
        feedback: [...document.querySelectorAll('.capture-feedback,.capture-note,.pending-capture')].map(node => node.textContent?.trim()).filter(Boolean),
        pendingImages: document.querySelectorAll('.pending-capture img').length,
        encryptedQueueJobs: encryptedQueueKeys.length,
      }
    })
    console.error(JSON.stringify({ saveDiagnostics }))
    throw error
  }

  stage = 'offline-capture-retry'
  await expect.poll(async () => (await encryptedJobs(page)).some(job => job.received),
    { timeout: 45_000 }).toBe(true)
  await primary.setOffline(true)
  await shutter.click()
  await expect.poll(async () => (await encryptedJobs(page)).length,
    { timeout: 45_000 }).toBe(2)
  expect((await encryptedJobs(page)).some(job => !job.received)).toBe(true)
  await primary.setOffline(false)
  await expect.poll(async () => {
    const jobs = await encryptedJobs(page)
    return jobs.length === 2 && jobs.every(job => job.received)
  }, { timeout: 60_000 }).toBe(true)

  stage = 'gallery-open'
  await page.getByRole('navigation').getByRole('link', { name: 'Браузер', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/browser`)
  const tile = page.locator('.browser-library-photo').first()
  await expect(tile).toBeVisible({ timeout: 45_000 })
  await tile.click()
  await expect(page.locator('.photo-view-stage img')).toBeVisible({ timeout: 45_000 })

  stage = 'photo-note'
  await page.getByRole('button', { name: 'Данные', exact: true }).click()
  const detailsDialog = page.getByRole('dialog', { name: 'Изменить данные', exact: true })
  await detailsDialog.getByLabel('Описание', { exact: true }).fill('QA Stage 6 note')
  await detailsDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(detailsDialog).toHaveCount(0, { timeout: 45_000 })

  stage = 'photo-card'
  await page.getByRole('button', { name: 'Карточка', exact: true }).click()
  await expect(page).toHaveURL(/\/gallery\/[0-9a-f-]+\/card$/)
  await expect(page.getByRole('heading', { name: 'Карточка фотографии', exact: true })).toBeVisible()
  await expect(page.locator('.photo-card-intro')).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('.photo-card-intro')).toContainText('QA Stage 6 note')
  await page.goBack()
  await expect(page.locator('.photo-view-stage img')).toBeVisible({ timeout: 30_000 })

  stage = 'photo-editor'
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await expect(page).toHaveURL(/\/gallery\/[0-9a-f-]+\/edit$/)
  await expect(page.locator('.editor-image-stage canvas')).toBeVisible({ timeout: 45_000 })
  await page.getByRole('button', { name: 'Повернуть', exact: true }).click()
  const saveVersion = page.getByRole('button', { name: 'Сохранить версию', exact: true })
  await saveVersion.click()
  await expect.poll(async () => {
    if (!page.url().endsWith('/edit') || await saveVersion.count() === 0) return true
    return saveVersion.isDisabled({ timeout: 1_000 })
  }, { timeout: 45_000 }).toBe(true)

  stage = 'photo-browser'
  await page.goto(`${origin}/browser?assignment=${assignmentId}`)
  await expect(page.getByRole('heading', { name: 'Photo Browser', exact: true })).toBeVisible()
  await expect(page.locator('.browser-library-photo').first()).toBeVisible({ timeout: 45_000 })

  stage = 'team-create'
  await page.goto(`${origin}/people`)
  await page.getByRole('button', { name: 'Создать команду', exact: true }).first().click()
  const teamDialog = page.getByRole('dialog', { name: 'Создать команду', exact: true })
  await teamDialog.getByLabel('Название', { exact: true }).fill('QA Stage 6 team')
  await teamDialog.getByLabel('Описание', { exact: true }).fill('QA production team flow')
  await teamDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page).toHaveURL(/\/profile\/teams\/[0-9a-f-]+$/, { timeout: 45_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'QA Stage 6 team', exact: true })).toBeVisible()

  stage = 'responsive-shell'
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/assignments`)
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 45_000 })
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)
  expect(runtimeErrors).toEqual([])

  console.log(JSON.stringify({
    coreFlows: 'pass',
    accountCreate: 'pass',
    accountRecoverySecondDevice: 'pass',
    assignmentCreate: 'pass',
    encryptedCameraCapture: 'pass',
    offlineCaptureRetrySync: 'pass',
    photoNote: 'pass',
    galleryAndPhotoCard: 'pass',
    editorVersionCommit: 'pass',
    photoBrowser: 'pass',
    teamCreate: 'pass',
    desktopOverflow: 'pass',
    runtimeErrors: 0,
  }))
} catch (error) {
  throw new Error(`core_flows_${stage}: ${error instanceof Error ? error.message : 'unknown'}`)
} finally {
  await primary.close()
  await browser.close()
}
