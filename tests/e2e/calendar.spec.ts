import { expect, test } from './fixtures'
import { copy } from '../../src/copy'

const cal = copy.calendar

/**
 * ปฏิทินหน้าแรกและตัวนับคอร์ส — สองเรื่องที่เจ้าของทักมาหลังเห็นของจริง (12 ก.ย.)
 *
 * 1 ตารางเดือนเต็มจอดันงานของวันนี้ตกจอ ปฏิทินจึงย่อไว้เป็นสัปดาห์เดียว แล้วกางด้วยปุ่มเดียว
 * 2 เลข "7/10" ลอย ๆ อ่านไม่ออกว่าคืออะไร ต้องเขียนว่า "สอนไปแล้ว 7/10" และครบแล้วต่อคอร์สได้
 */
test.describe('ปฏิทินหน้าแรก', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('?scenario=default#/app/today')
    await expect(page.locator('.skel')).toHaveCount(0)
    await expect(page.locator('.cal__grid')).toBeVisible()
  })

  test('เปิดแอปมาเห็นงานของวันนี้โดยไม่ต้องเลื่อนจอ', async ({ page }) => {
    await expect(page.locator('.cal__day')).toHaveCount(7)
    const height = page.viewportSize()?.height ?? 844
    const box = await page.locator('.urow').first().boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeLessThan(height)
  })

  test('กดปุ่มปฏิทินกางเป็นทั้งเดือน กดอีกทีย่อกลับที่เดิม', async ({ page }) => {
    const selected = await page.locator('.cal__day--on').getAttribute('aria-label')
    await page.getByRole('button', { name: cal.expand }).click()
    expect(await page.locator('.cal__day').count()).toBeGreaterThanOrEqual(28)
    await expect(page.getByText(/ทั้งเดือน \d+ คาบ/)).toBeVisible()

    await page.getByRole('button', { name: cal.collapse }).click()
    await expect(page.locator('.cal__day')).toHaveCount(7)
    // ย่อกลับแล้วยังอยู่ที่วันเดิม ไม่ใช่เด้งไปวันอื่น
    await expect(page.locator('.cal__day--on')).toHaveAttribute('aria-label', selected!)
  })

  test('ย่ออยู่ลูกศรเลื่อนทีละสัปดาห์ กางอยู่เลื่อนทีละเดือน', async ({ page }) => {
    const heading = page.locator('.h1').first()
    const start = await heading.innerText()
    await page.getByRole('button', { name: cal.nextWeek }).click()
    await expect(heading).not.toHaveText(start)
    await expect(page.getByRole('button', { name: cal.backToToday })).toBeVisible()
    await page.getByRole('button', { name: cal.backToToday }).click()
    await expect(heading).toHaveText(start)

    await page.getByRole('button', { name: cal.expand }).click()
    const month = await page.locator('.cal__title').innerText()
    await page.getByRole('button', { name: cal.next }).click()
    await expect(page.locator('.cal__title')).not.toHaveText(month)
  })
})

test.describe('ตัวนับคอร์ส', () => {
  const openCourseStudent = async (page: import('@playwright/test').Page) => {
    await page.goto('?scenario=default#/app/subjects')
    await expect(page.locator('.skel')).toHaveCount(0)
    // แถวที่มีตัวนับคอร์ส = ไม่ใช่แพ็ก (แพ็กมีตัวนับของตัวเอง)
    await page.locator('.srow').filter({ hasText: 'สอนไปแล้ว' }).first().click()
    await expect(page.getByRole('heading', { name: copy.course.label })).toBeVisible()
  }

  const taught = async (page: import('@playwright/test').Page) => {
    const text = await page.locator('.card').filter({ hasText: copy.course.label }).locator('.kv .num').first().innerText()
    const [done, total] = text.split('/').map(Number)
    return { done, total }
  }

  test('รายชื่อบอกว่าเลขนั้นคืออะไร ไม่ใช่ "7/10" ลอย ๆ', async ({ page }) => {
    await page.goto('?scenario=default#/app/subjects')
    await expect(page.locator('.skel')).toHaveCount(0)
    await expect(page.locator('.srow__meta').filter({ hasText: /สอนไปแล้ว \d+\/\d+/ }).first()).toBeVisible()
  })

  test('ต่อคอร์สแล้วเริ่มนับใหม่ที่ 0 และบอกว่าประวัติไม่หาย', async ({ page }) => {
    await openCourseStudent(page)
    const before = await taught(page)

    await page.getByRole('button', { name: copy.course.renew }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText('ยังอยู่ครบ')
    await sheet.getByRole('button', { name: copy.course.renew }).click()

    await expect.poll(async () => (await taught(page)).done).toBe(0)
    expect((await taught(page)).total).toBe(before.total)
  })

  test('แถมครั้งเพิ่มเพดานของคอร์สรอบนี้', async ({ page }) => {
    await openCourseStudent(page)
    const before = await taught(page)

    await page.getByRole('button', { name: copy.course.bonus }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: '2', exact: true }).click()
    await sheet.getByRole('button', { name: copy.common.save }).click()

    await expect.poll(async () => (await taught(page)).total).toBe(before.total + 2)
    expect((await taught(page)).done).toBe(before.done)
  })
})
