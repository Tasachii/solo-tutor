import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('first installation can reopen offline without a preparatory reload', async ({ page, context, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium' || process.env.SOLO_LINE_QA === '1', 'real service worker test')
  await page.goto('#/app/today')
  await expect(page.locator('.greet')).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.greet')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('16px Anuphan', 'ทดสอบ'))).toBe(true)
  await expect(page.locator('link[as="font"]')).toHaveAttribute('href', `${new URL(baseURL!).pathname}fonts/Anuphan.ttf`)
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
  expect(resources.some((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))).toBe(false)
  // These routes have not been visited online. Their lazy chunks and the guide
  // must already belong to the installed release, not depend on a warm browser cache.
  await page.goto('#/app/help')
  await expect(page.getByRole('link', { name: /ดาวน์โหลดคู่มือ/ })).toBeVisible()
  const downloadReady = page.waitForEvent('download')
  await page.getByRole('link', { name: /ดาวน์โหลดคู่มือ/ }).click()
  const download = await downloadReady
  const path = await download.path()
  expect((await readFile(path!)).subarray(0, 5).toString()).toBe('%PDF-')
  expect(await page.evaluate(async () => {
    const guide = await fetch('solo-tutor-guide.pdf')
    return guide.ok && (await guide.text()).startsWith('%PDF-')
  })).toBe(true)
  await page.goto('#/pricing')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await context.setOffline(false)
})

test('installing Solo Tutor preserves another application cache', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium' || process.env.SOLO_LINE_QA === '1', 'real service worker test')
  await page.goto('favicon.svg')
  await page.evaluate(async () => {
    const cache = await caches.open('unrelated-app-v1')
    await cache.put('/unrelated-app/data', new Response('keep me'))
  })
  await page.goto('#/app/today')
  // A hash on favicon.svg does not load the application shell.
  await page.goto('./#/app/today')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  expect(await page.evaluate(() => caches.keys())).toContain('unrelated-app-v1')
})

test('embedded pages offer a direct link without rendering tutor data', async ({ page, baseURL }) => {
  // An HTML parent on the test origin avoids Chromium's opaque-origin/private-
  // network restriction while deliberately omitting this app's frame-src policy.
  const host = new URL('qa-host.html', baseURL).href
  await page.route(host, (route) => route.fulfill({ contentType: 'text/html',
    body: `<iframe title="embedded app" src="${baseURL}#/app/today"></iframe>` }))
  await page.goto(host)
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'เปิด Solo Tutor ในหน้าต่างหลัก' })).toBeVisible()
  await expect(frame.locator('.greet, .urow, .shell__menu')).toHaveCount(0)
  await expect(frame.getByRole('link', { name: 'เปิดหน้าต่างหลัก' })).toHaveAttribute('target', '_top')
})

test('built page blocks injected inline scripts with CSP', async ({ page }) => {
  await page.goto('#/app/today')
  await expect(page.locator('.greet')).toBeVisible()
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__injected = true'
    document.body.append(script)
  })
  expect(await page.evaluate(() => '__injected' in window)).toBe(false)
})
