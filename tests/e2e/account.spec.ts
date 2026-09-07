import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'

const openReal = async (page: Page, hash: string): Promise<void> => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('solo-demo-v3'))).not.toBeNull()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('solo-demo-v3')!)
    saved.mode = 'real'; saved.scenarioId = 'real'; saved.onboarded = true
    saved.provider = { name: 'ครู QA', promptpayId: '0812345678' }
    localStorage.setItem('solo-demo-v3', JSON.stringify(saved))
  })
  await page.goto(`#${hash}`)
  await page.reload()
  await expect(page.locator('.skel')).toHaveCount(0)
}

/** ตัวนับการใช้งานยิงจากทุกหน้า — build ของคำสั่ง QA ชี้ไป host ที่ไม่มีจริง ต้องรับไว้ไม่งั้น console error ทำเทสล้ม */
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/[^/]*\.supabase\.co\/functions\/v1\/(usage|report-error)$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
})

test('เมนูมีทางเข้าหน้าบัญชีครู และในโหมดเดโมหน้านั้นบอกให้เริ่มใช้จริงก่อน', async ({ page }) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await page.getByRole('button', { name: copy.menu.title }).click()
  await page.getByRole('button', { name: copy.account.menu }).click()
  await expect(page.getByRole('heading', { name: copy.account.title })).toBeVisible()
  await expect(page.getByText(copy.account.demoOnly)).toBeVisible()
})

test('โหมดจริงเห็นฟอร์มบัญชีครูหรือการ์ดรอตั้งค่า — ไม่มีอย่างอื่น และไม่มีข้อมูลออกจากเครื่องก่อนเข้าสู่ระบบ', async ({ page }) => {
  const outbound: string[] = []
  page.on('request', (r) => { if (/supabase\.co/.test(r.url())) outbound.push(r.url()) })
  await openReal(page, '/app/settings/account')
  await expect(page.getByRole('heading', { name: copy.account.title })).toBeVisible()
  const form = page.getByRole('heading', { name: 'เข้าสู่ระบบบัญชีครู' })
  const waiting = page.getByRole('heading', { name: copy.account.notConfigured })
  await expect(form.or(waiting)).toBeVisible()
  if (await form.isVisible()) {
    await expect(page.getByText(copy.account.encrypted).first()).toBeVisible()
    await page.getByRole('button', { name: 'ยังไม่มีบัญชี สมัครใช้งาน' }).click()
    await expect(page.getByRole('heading', { name: 'สมัครบัญชีครู' })).toBeVisible()
  }
  // ยังไม่เข้าสู่ระบบ = ห้ามยิงอะไรไปคลาวด์ (ใช้งานได้เหมือนเดิมโดยไม่มีบัญชี)
  await page.getByRole('link', { name: copy.common.back }).click()
  await expect(page).toHaveURL(/#\/app\/today/)
  expect(outbound.filter((u) => /ledger_snapshots|save_ledger_snapshot/.test(u))).toEqual([])
})

/** ส่วนที่คุยกับ Supabase จำลอง — รันเฉพาะคำสั่ง QA ที่ build ด้วย VITE_SUPABASE_URL=https://line-qa.supabase.co */
const projectOrigin = 'https://line-qa.supabase.co'
const providerId = '11111111-1111-4111-8111-111111111111'

const installCloud = async (page: Page, head: { revision: number } | null) => {
  const planRequests: Record<string, unknown>[] = []
  const seen = { saves: [] as Record<string, unknown>[], reads: 0, planRequests }
  await page.route(`${projectOrigin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/token') {
      return json({ access_token: 'qa-jwt', refresh_token: 'qa-refresh', expires_in: 3600, user: { id: providerId, email: 'teacher@example.com' } })
    }
    // ตัวนับการใช้งานและรายงานข้อผิดพลาดยิงจากทุกหน้า — รับไว้เฉย ๆ ไม่ใช่เรื่องของเทสนี้
    if (url.pathname === '/functions/v1/usage' || url.pathname === '/functions/v1/report-error') return json({ ok: true })
    if (url.pathname === '/rest/v1/providers' && request.method() === 'GET') return json([{ plan: 'free', plan_until: null, paused_at: null }])
    if (url.pathname === '/rest/v1/plan_requests' && request.method() === 'GET') return json(planRequests)
    if (url.pathname === '/rest/v1/ledger_snapshots' && request.method() === 'GET') {
      seen.reads += 1
      return json(head ? [{ revision: head.revision, schema_version: 5, cipher: 'bm90LXJlYWw=', iv: 'aXY=', updated_at: '2026-09-07T01:00:00Z', device: 'iPhone/iPad' }] : [])
    }
    if (url.pathname === '/rest/v1/rpc/save_ledger_snapshot') {
      const body = request.postDataJSON() as Record<string, unknown>
      seen.saves.push(body)
      head = { revision: Number(body.p_revision) }
      return json([{ ok: true, revision: body.p_revision, updated_at: '2026-09-07T02:00:00Z' }])
    }
    if (url.pathname === '/rest/v1/rpc/request_plan') {
      const body = request.postDataJSON() as { p_months: number; p_note: string }
      const row = { id: `req-${planRequests.length + 1}`, months: body.p_months, amount: { 1: 299, 3: 799, 12: 2490 }[body.p_months], note: body.p_note || null, status: 'pending', created_at: '2026-09-07T03:00:00Z', decided_at: null, receipt_no: null }
      planRequests.unshift(row)
      return json([row])
    }
    if (url.pathname === '/rest/v1/rpc/cancel_plan_request') { planRequests.splice(0); return json(true) }
    if (url.pathname === '/rest/v1/line_channel_public') return json([])
    throw new Error(`Unhandled mock Supabase request: ${request.method()} ${url.pathname}`)
  })
  return seen
}

test.describe('ซิงก์คลาวด์กับ Supabase จำลอง', () => {
  test.skip(process.env.SOLO_LINE_QA !== '1', 'ต้อง build ด้วย VITE_SUPABASE_URL ชี้ไปที่ mock')

  test('เข้าสู่ระบบแล้วสมุดบัญชีขึ้นคลาวด์เอง — เป็น ciphertext ไม่มีชื่อนักเรียน และแก้ข้อมูลแล้วขึ้นรอบใหม่', async ({ page }) => {
    const seen = await installCloud(page, null)
    await openReal(page, '/app/settings/account')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    expect(seen.saves).toHaveLength(1)
    expect(seen.saves[0]).toMatchObject({ p_expected_revision: 0, p_revision: 1, p_schema_version: 5, p_kdf: 'pbkdf2-sha256-310000' })
    const cipher = String(seen.saves[0].p_cipher)
    expect(cipher.length).toBeGreaterThan(1000)
    expect(atob(cipher)).not.toContain('น้องภูมิ')

    // แก้ข้อมูลหนึ่งครั้ง → รอบถัดไปต้องอ้าง revision 1 ที่เพิ่งได้ ไม่ใช่ 0
    await page.goto('#/app/today')
    await page.getByRole('button', { name: 'เช็คชื่อ' }).first().click()
    await expect.poll(() => seen.saves.length, { timeout: 15_000 }).toBe(2)
    expect(seen.saves[1]).toMatchObject({ p_expected_revision: 1, p_revision: 2 })
    await expect(page.locator('.toast, [role=alert]').filter({ hasText: copy.account.conflictToast })).toHaveCount(0)
  })

  test('เครื่องมีข้อมูลและคลาวด์ก็มี — ไม่เดา ถามครู แล้ว "ใช้ข้อมูลเครื่องนี้" เขียนทับด้วย revision ของคลาวด์', async ({ page }) => {
    const seen = await installCloud(page, { revision: 7 })
    await openReal(page, '/app/settings/account')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.conflict, { timeout: 15_000 })
    expect(seen.saves).toHaveLength(0)
    await expect(page.getByText('iPhone/iPad')).toBeVisible()
    await page.getByRole('button', { name: copy.account.useLocal }).first().click()
    await page.getByRole('button', { name: copy.account.useLocal }).last().click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    expect(seen.saves).toHaveLength(1)
    expect(seen.saves[0]).toMatchObject({ p_expected_revision: 7, p_revision: 8 })
  })
})

test('แพ็กฟรีรับได้ 5 คนที่ยังเรียนอยู่ — คนที่ 6 เจอชีทแพ็ก ไม่ถูกเพิ่มเงียบ ๆ', async ({ page }) => {
  await page.goto('?scenario=default#/app/today')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('solo-demo-v3'))).not.toBeNull()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('solo-demo-v3')!)
    saved.mode = 'real'; saved.scenarioId = 'real'; saved.onboarded = true
    saved.provider = { name: 'ครู QA', promptpayId: '0812345678' }
    saved.subjects = saved.subjects.map((s: { active: boolean }, i: number) => ({ ...s, active: i < 5 }))
    localStorage.setItem('solo-demo-v3', JSON.stringify(saved))
  })
  await page.goto('#/app/subjects')
  await page.reload()
  await expect(page.locator('.skel')).toHaveCount(0)
  const before = await page.locator('.srow').count()
  await page.getByRole('button', { name: `+ ${copy.subjects.add}` }).click()
  await page.getByLabel(copy.subjects.fieldName, { exact: true }).fill('น้องใหม่')
  await page.getByLabel(copy.subjects.fieldClient, { exact: true }).fill('คุณแม่ใหม่')
  await page.getByRole('button', { name: copy.common.save }).click()
  await expect(page.getByText(copy.plan.capTitle)).toBeVisible()
  await expect(page.getByText('ตอนนี้มี 5 จาก 5 คน')).toBeVisible()
  await page.getByRole('button', { name: copy.plan.goUpgrade }).click()
  await expect(page).toHaveURL(/settings\/account\?plan=1/)
  await page.goto('#/app/subjects')
  await expect(page.locator('.srow')).toHaveCount(before)
  await expect(page.getByText('น้องใหม่')).toHaveCount(0)
})

test.describe('แพ็กสมาชิกกับ Supabase จำลอง', () => {
  test.skip(process.env.SOLO_LINE_QA !== '1', 'ต้อง build ด้วย VITE_SUPABASE_URL ชี้ไปที่ mock')
  test('ขอเปิด Pro 3 เดือน — ส่งแค่จำนวนเดือน ยอดมาจากเซิร์ฟเวอร์ แล้วเห็นสถานะรอตรวจยอด ยกเลิกได้', async ({ page }) => {
    const seen = await installCloud(page, null)
    await openReal(page, '/app/settings/account?plan=3')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    const card = page.getByTestId('plan-card')
    await expect(card).toContainText('สูงสุด 5')
    await expect(card.getByRole('radio', { name: /3 เดือน/ })).toHaveAttribute('aria-checked', 'true')
    await card.getByLabel(copy.plan.note).fill('โอนแล้ว 09:41')
    await card.getByRole('button', { name: /ส่งคำขอ/ }).click()
    await expect(card).toContainText('รอตรวจยอด')
    expect(seen.planRequests[0]).toMatchObject({ months: 3, amount: 799, note: 'โอนแล้ว 09:41' })
    await card.getByRole('button', { name: copy.plan.cancel }).click()
    await page.getByRole('button', { name: copy.plan.cancel }).last().click()
    await expect(card).not.toContainText('รอตรวจยอด')
  })
})
