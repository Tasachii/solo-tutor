import { test as plainTest } from '@playwright/test'
import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import { copy } from '../../src/copy'

/** สีแถบสถานะมือถือต้องตรงกับพื้นหลังจริง — เคยค้างเป็นชุดสีก่อนรีดีไซน์อยู่หลายวัน (vitest อ่าน css?raw ไม่ได้ จึงตรวจที่นี่) */
test('theme-color meta matches the real --bg of each theme', async () => {
  const html = readFileSync('index.html', 'utf8')
  const css = readFileSync('src/index.css', 'utf8')
  const meta = (scheme: string) => html.match(new RegExp(`theme-color" content="(#[0-9a-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)"`))![1]
  const bgOf = (block: string) => block.match(/--bg:(#[0-9a-f]{6})/)![1]
  expect(meta('light')).toBe(bgOf(css.slice(0, css.indexOf('@media'))))
  expect(meta('dark')).toBe(bgOf(css.slice(css.indexOf('prefers-color-scheme: dark'))))
  expect(html).toContain('apple-mobile-web-app-status-bar-style')
})

/**
 * "แอป" ต้องมีพฤติกรรมของแอป: เปิดถูกหน้า · เปิดออฟไลน์ได้ · มีหน้านโยบายให้กด
 * ก่อนหน้านี้ทั้งสามอย่างไม่มี ทั้งที่ manifest กับ sw.js อยู่ในโปรเจกต์มาตลอด
 */
test('installed app opens on today, not the marketing page', async ({ page }) => {
  // เบราว์เซอร์ทดสอบปลอมสัญญาณ standalone ให้ไม่ได้ จึงปลอม matchMedia — เราทดสอบการตอบสนองของแอป ไม่ใช่ตัวสัญญาณ
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => query.includes('display-mode: standalone')
      ? ({ matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList)
      : original(query)
  })
  await page.goto('./')
  await expect(page).toHaveURL(/#\/app\/today$/)
  await expect(page.locator('.land')).toHaveCount(0)
  await expect(page.getByText(copy.nav.today).first()).toBeVisible()
})

// ใช้ test ธรรมดา: ตอนตัดเน็ต request ฝั่ง SW ล้มเป็นเรื่องปกติ fixture ที่จับ network error จะฟ้องผิด
plainTest('the service worker is registered and the app opens offline', async ({ page, context, browserName }) => {
  plainTest.skip(browserName !== 'chromium', 'ตรวจ SW บน Chromium พอ')
  await page.goto('#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  const registered = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    return (await navigator.serviceWorker.getRegistrations()).length
  })
  expect(registered).toBeGreaterThanOrEqual(1)

  // โหลดรอบสองให้ SW คุมหน้าและเก็บ asset ครบ แล้วตัดเน็ต
  await page.reload()
  await expect(page.locator('.skel')).toHaveCount(0)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText(/สวัสดี/)).toBeVisible()
  await context.setOffline(false)
})

test('privacy and terms are reachable and say what the app really does', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: copy.legal.footerPrivacy }).click()
  await expect(page).toHaveURL(/#\/privacy$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.legal.privacyTitle)
  await expect(page.getByText('เฉพาะเมื่อคุณเชื่อม LINE OA')).toBeVisible()
  await expect(page.getByText('พิมพ์ "หยุด"', { exact: false })).toBeVisible()

  await page.getByRole('link', { name: copy.legal.termsTitle }).click()
  await expect(page).toHaveURL(/#\/terms$/)
  await expect(page.getByText('ไม่ใช่คนกลาง')).toBeVisible()

  await page.goto('#/pricing')
  await expect(page.getByRole('link', { name: copy.legal.footerTerms })).toBeVisible()
})
