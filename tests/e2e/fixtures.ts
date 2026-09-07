import { test as base, expect, type Page } from '@playwright/test'
export { expect }
export type { Page } from '@playwright/test'

/** Every flow checks app failures; remote font availability is not an app API failure. */
/** เดโมเดินตามปฏิทินจริง — ตรึงวันไว้ให้ตรงกับวันที่ชุดข้อมูลถูกเขียน (ดู tests/setup.ts) */
export const FROZEN_TODAY = '2025-09-02'

export const test = base.extend<{ frozenClock: void; appErrors: void }>({
  frozenClock: [async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(`${FROZEN_TODAY}T09:00:00+07:00`))
    await use()
  }, { auto: true }],
  appErrors: [async ({ page, context, baseURL }, use) => {
    const errors: string[] = []
    const appOrigin = new URL(baseURL!).origin
    const watch = (observed: Page) => {
      observed.on('pageerror', error => errors.push(error.message))
      observed.on('console', message => {
        if (message.type() === 'error') errors.push(message.text())
      })
      observed.on('requestfailed', request => {
        if (new URL(request.url()).origin === appOrigin && !request.failure()?.errorText.includes('ERR_ABORTED')) {
          errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
        }
      })
      observed.on('response', response => {
        if (new URL(response.url()).origin === appOrigin && response.status() >= 500) {
          errors.push(`${response.status()} ${response.url()}`)
        }
      })
    }
    watch(page)
    context.on('page', watch)
    await use()
    context.off('page', watch)
    expect(errors, 'unexpected app console/network errors').toEqual([])
  }, { auto: true }],
})
