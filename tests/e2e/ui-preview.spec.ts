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

test('anonymous Photos and Browser never expose fabricated or shared photo records', async ({ page }) => {
  await page.goto('/photos')
  await expect(page.getByTestId('encrypted-gallery')).toBeVisible()
  await expect(page.locator('.photo-tile,.gallery-item')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Create account|Создать аккаунт/i }).first()).toBeVisible()
  await page.goto('/browser')
  const native = page.getByTestId('native-photo-browser')
  await expect(native).toBeVisible()
  await expect(native.locator('.pb-browser-photo')).toHaveCount(0)
  await expect(native.getByRole('link',{name:/Create account|Создать аккаунт/i})).toBeVisible()
  await expect(native.getByRole('link',{name:/Restore access|Восстановить доступ/i})).toBeVisible()
})

test('native account locale, appearance and 320px mobile safe-area layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 680 })
  await page.goto('/profile')
  await expect(page.getByRole('heading',{name:/My account|Мой аккаунт/i})).toBeVisible()
  // The PB2 profile exposes language and appearance via native select controls.
  const preferences=page.locator('.pb-profile-controls select')
  await expect(preferences).toHaveCount(2)
  await preferences.nth(1).selectOption('ru')
  await expect(page.getByRole('heading',{name:'Мой аккаунт',exact:true})).toBeVisible()
  await preferences.nth(0).selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme','light')
  await expect(page.locator('html')).toHaveAttribute('lang','ru')
  // Diagnose actual 320px overflow rather than hiding content with overflow-x:hidden.
  const overflowReport=()=>page.evaluate(()=>{
    const viewport=window.innerWidth
    const offenders=[...document.querySelectorAll<HTMLElement>('body *')]
      .map(el=>({tag:el.tagName.toLowerCase(),className:String(el.className).slice(0,100),
        text:(el.textContent||'').trim().slice(0,60),rect:el.getBoundingClientRect()}))
      .filter(x=>x.rect.right>viewport+1&&x.rect.width>1)
      .map(x=>({tag:x.tag,className:x.className,text:x.text,
        left:Math.round(x.rect.left),right:Math.round(x.rect.right),width:Math.round(x.rect.width)}))
      .sort((a,b)=>b.right-a.right).slice(0,15)
    return {viewport,scrollWidth:document.documentElement.scrollWidth,offenders}
  })
  const initial=await overflowReport()
  if(initial.scrollWidth>initial.viewport)console.log('320px overflow elements:',JSON.stringify(initial))
  await expect.poll(async()=>{const x=await overflowReport();return x.scrollWidth<=x.viewport}).toBe(true)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme','light')
  await expect(page.locator('html')).toHaveAttribute('lang','ru')
})

test('Camera requires a real authenticated account and never simulates a saved photo', async ({ page }) => {
  const photoEndpoints: string[] = []
  page.on('request', request => {
    if (/\/api\/photos|\/s3\/|\/garage\/|\/_matrix\/|livekit/i.test(request.url()))
      photoEndpoints.push(request.url())
  })
  await page.goto('/camera')
  await expect(page.getByTestId('production-camera')).toBeVisible()
  await expect(page.getByRole('button', { name: /Take photo|Снять фото/i })).toHaveCount(0)
  await page.goto('/photos')
  await expect(page.locator('.gallery-item')).toHaveCount(0)
  expect(photoEndpoints).toEqual([])
})
