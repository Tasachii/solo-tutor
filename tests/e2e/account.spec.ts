import { expect, test, type Page } from './fixtures'
import { copy } from '../../src/copy'
import { deriveKey } from '../../src/core/cloudCrypto'
import { packSnapshot } from '../../src/core/cloudSync'
import type { AppState } from '../../src/core/types'
import { readFile } from 'node:fs/promises'
import { test as plainTest } from '@playwright/test'

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
  // Force one document navigation so StoreProvider hydrates the edited local
  // state. A hash navigation followed immediately by reload races lazy imports
  // in WebKit and reports a cancelled module as an application crash.
  await page.goto(`?qa-real=1#${hash}`)
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

const installCloud = async (page: Page, head: { revision: number; cipher?: string; iv?: string; kdf?: string } | null) => {
  const planRequests: Record<string, unknown>[] = []
  let snapshot: Record<string, unknown> | null = head
    ? { revision: head.revision, schema_version: 5, cipher: head.cipher ?? 'bm90LXJlYWw=', iv: head.iv ?? 'aXY=', kdf: head.kdf ?? 'pbkdf2-sha256-310000', updated_at: '2026-09-07T01:00:00Z', device: 'iPhone/iPad' }
    : null
  let providerPlan = { plan: 'free', plan_until: null as string | null, paused_at: null as string | null }
  const seen = {
    saves: [] as Record<string, unknown>[], reads: 0, planRequests,
    deletions: 0, deletionStatus: 200,
    approveLatest() {
      const row = planRequests.find((request) => request.status === 'pending')
      if (!row) throw new Error('No pending plan request to approve')
      row.status = 'approved'; row.decided_at = '2025-09-02T10:00:00+07:00'; row.receipt_no = 'SP-202509-0001'
      providerPlan = { plan: 'pro', plan_until: '2025-12-01', paused_at: null }
    },
    expireOriginalWhilePaused() {
      providerPlan = { plan: 'pro', plan_until: '2025-08-01', paused_at: '2025-07-01T00:00:00Z' }
    },
    expirePlan() { providerPlan = { plan: 'pro', plan_until: '2025-09-01', paused_at: null } },
  }
  await page.context().route(`${projectOrigin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/token') {
      return json({ access_token: 'qa-jwt', refresh_token: 'qa-refresh', expires_in: 3600, user: { id: providerId, email: 'teacher@example.com' } })
    }
    // ตัวนับการใช้งานและรายงานข้อผิดพลาดยิงจากทุกหน้า — รับไว้เฉย ๆ ไม่ใช่เรื่องของเทสนี้
    if (url.pathname === '/functions/v1/usage' || url.pathname === '/functions/v1/report-error') return json({ ok: true })
    if (url.pathname === '/functions/v1/delete-account') {
      seen.deletions += 1
      return seen.deletionStatus === 200 ? json({ ok: true }) : json({ ok: false, error: 'retention-required' }, seen.deletionStatus)
    }
    if (url.pathname === '/rest/v1/providers' && request.method() === 'GET') return json([providerPlan])
    if (url.pathname === '/rest/v1/plan_requests' && request.method() === 'GET') return json(planRequests)
    if (url.pathname === '/rest/v1/ledger_snapshots' && request.method() === 'GET') {
      seen.reads += 1
      return json(snapshot ? [snapshot] : [])
    }
    if (url.pathname === '/rest/v1/rpc/save_ledger_snapshot') {
      const body = request.postDataJSON() as Record<string, unknown>
      seen.saves.push(body)
      head = { revision: Number(body.p_revision) }
      snapshot = {
        revision: body.p_revision, schema_version: body.p_schema_version, cipher: body.p_cipher,
        iv: body.p_iv, kdf: body.p_kdf, updated_at: '2026-09-07T02:00:00Z', device: body.p_device,
      }
      return json([{ ok: true, revision: body.p_revision, updated_at: '2026-09-07T02:00:00Z' }])
    }
    if (url.pathname === '/rest/v1/rpc/request_plan') {
      const body = request.postDataJSON() as { p_months: number; p_note: string }
      const row = { id: `req-${planRequests.length + 1}`, months: body.p_months, amount: { 1: 299, 3: 799, 12: 2490 }[body.p_months], note: body.p_note || null, status: 'pending', created_at: '2026-09-07T03:00:00Z', decided_at: null, receipt_no: null }
      planRequests.unshift(row)
      return json([row])
    }
    if (url.pathname === '/rest/v1/rpc/cancel_plan_request') { planRequests.splice(0); return json(true) }
    if (url.pathname === '/rest/v1/rpc/pause_plan') {
      providerPlan = { ...providerPlan, paused_at: '2025-09-02T10:30:00+07:00' }
      return json([providerPlan])
    }
    if (url.pathname === '/rest/v1/rpc/resume_plan') {
      providerPlan = { plan: 'pro', plan_until: '2025-10-03', paused_at: null }
      return json([providerPlan])
    }
    if (url.pathname === '/rest/v1/line_channel_public') return json([])
    throw new Error(`Unhandled mock Supabase request: ${request.method()} ${url.pathname}`)
  })
  return seen
}

test.describe('ซิงก์คลาวด์กับ Supabase จำลอง', () => {
  test.skip(process.env.SOLO_LINE_QA !== '1', 'ต้อง build ด้วย VITE_SUPABASE_URL ชี้ไปที่ mock')

  test('ลบบัญชีจากแท็บอ่านอย่างเดียวไม่ได้ และเมื่อแท็บหลักลบแล้วอีกแท็บไม่คืนข้อมูลเก่า', async ({ page, context }) => {
    const seen = await installCloud(page, null)
    await openReal(page, '/app/settings/account')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    await page.evaluate(() => localStorage.setItem('unrelated-app-preference', 'keep'))
    const other = await context.newPage()
    await other.clock.setFixedTime(new Date('2025-09-02T09:00:00+07:00'))
    await other.goto(page.url())
    await expect(other.getByRole('button', { name: copy.account.deleteAccountTitle, exact: true })).toBeVisible()
    const submitDeletion = async (target: Page) => {
      await target.getByRole('button', { name: copy.account.deleteAccountTitle, exact: true }).click()
      const dialog = target.getByRole('dialog', { name: copy.account.deleteAccountTitle })
      await dialog.getByLabel(copy.account.deleteAccountPassword, { exact: true }).fill('qa-password')
      await dialog.getByLabel(copy.account.deleteAccountType, { exact: true }).fill('ลบบัญชี')
      await dialog.getByRole('button', { name: copy.account.deleteAccountConfirm, exact: true }).click()
    }
    await expect(other.getByRole('button', { name: copy.account.deleteAccountTitle, exact: true })).toBeDisabled()
    expect(seen.deletions).toBe(0)
    await submitDeletion(page)
    await expect.poll(() => seen.deletions).toBe(1)
    const remaining = (target: Page) => target.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('solo-demo-v3') ?? '{}')
      return { subjects: raw.subjects?.length ?? 0, provider: raw.provider?.name ?? '' }
    })
    await expect.poll(() => remaining(page)).toEqual({ subjects: 0, provider: '' })
    await expect.poll(() => remaining(other)).toEqual({ subjects: 0, provider: '' })
    await expect(other.getByText('teacher@example.com', { exact: true })).toHaveCount(0)
    await page.close()
    await other.reload()
    await expect.poll(() => remaining(other)).toEqual({ subjects: 0, provider: '' })
    expect(await other.evaluate(() => localStorage.getItem('unrelated-app-preference'))).toBe('keep')
  })

  test('a paid teacher can erase operational data after seeing the retained-receipt explanation', async ({ page }) => {
    const seen = await installCloud(page, null)
    seen.planRequests.push({ id: 'paid-history', months: 1, amount: 299, status: 'approved',
      created_at: '2025-09-01T00:00:00Z', decided_at: '2025-09-01T01:00:00Z', receipt_no: 'SP-202509-0042' })
    await openReal(page, '/app/settings/account')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    await page.getByRole('button', { name: copy.account.deleteAccountTitle, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: copy.account.deleteAccountTitle })
    await expect(dialog).toContainText('เก็บเฉพาะข้อมูลการเงิน')
    await dialog.getByLabel(copy.account.deleteAccountPassword, { exact: true }).fill('qa-password')
    await dialog.getByLabel(copy.account.deleteAccountType, { exact: true }).fill('ลบบัญชี')
    await dialog.getByRole('button', { name: copy.account.deleteAccountConfirm, exact: true }).click()
    await expect.poll(() => seen.deletions).toBe(1)
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!).subjects.length)).toBe(0)
    await expect(page.getByText('teacher@example.com', { exact: true })).toHaveCount(0)
  })

  plainTest('a legacy backend refusal preserves the teacher ledger and account session', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2025-09-02T09:00:00+07:00'))
    const scriptErrors: string[] = []
    page.on('pageerror', (error) => scriptErrors.push(error.message))
    const seen = await installCloud(page, null)
    seen.deletionStatus = 409
    await openReal(page, '/app/settings/account')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!).subjects)
    await page.getByRole('button', { name: copy.account.deleteAccountTitle, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: copy.account.deleteAccountTitle })
    await dialog.getByLabel(copy.account.deleteAccountPassword, { exact: true }).fill('qa-password')
    await dialog.getByLabel(copy.account.deleteAccountType, { exact: true }).fill('ลบบัญชี')
    // Expected refusal deliberately emits one HTTP 409 in the browser console.
    const response = page.waitForResponse((r) => r.url().endsWith('/functions/v1/delete-account'))
    await dialog.getByRole('button', { name: copy.account.deleteAccountConfirm, exact: true }).click()
    expect((await response).status()).toBe(409)
    await expect(page.getByText(copy.account.retentionRequired, { exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!).subjects)).toEqual(before)
    await expect(page.getByText('teacher@example.com', { exact: true })).toBeVisible()
    expect(scriptErrors).toEqual([])
  })

  test('ไฟล์กู้คืนปลดล็อก ciphertext หลังเปลี่ยนรหัส โดยไม่ต้องลบข้อมูลบนคลาวด์', async ({ page }) => {
    const seen = await installCloud(page, null)
    await openReal(page, '/app/settings/account')
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!).subjects)
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: copy.account.recoveryExport }).click()
    const recovery = await pending
    const bytes = await readFile((await recovery.path())!)
    expect(JSON.parse(bytes.toString()).userId).toBe(providerId)
    await page.getByRole('button', { name: copy.account.signOut, exact: true }).click()
    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password-after-external-reset')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.locked, { timeout: 15_000 })
    await page.getByLabel(copy.account.recoveryImport, { exact: true }).setInputFiles({ name: 'mock-recovery.json', mimeType: 'application/json', buffer: bytes })
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!).subjects)).toEqual(before)
    expect(seen.deletions).toBe(0)
    expect(seen.saves).toHaveLength(1)
  })

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
    await openReal(page, '/app/settings/account')
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('solo-demo-v3')!)) as AppState
    const sealed = await packSnapshot({ ...local, provider: { ...local.provider, name: 'ครูจากอีกเครื่อง' } },
      await deriveKey('qa-password', providerId), '2025-09-01T00:00:00Z')
    const seen = await installCloud(page, { revision: 7, ...sealed })
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
  await page.goto('?qa-real=1#/app/subjects')
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

  test('วงจรรายได้ครบ: เลือกแพ็ก → เริ่มใช้จริง → ขอ Pro → อนุมัติ → ใบเสร็จ → พัก/ใช้ต่อ → หมดอายุแล้วยังส่งออกข้อมูลได้', async ({ page }) => {
    const seen = await installCloud(page, null)

    await page.goto('#/pricing')
    const selected = page.locator('.plan').filter({ hasText: copy.pricing.plans[2].name })
    await selected.getByRole('link', { name: copy.pricing.plans[2].cta }).click()
    await expect(page).toHaveURL(/#\/start\?plan=3$/)
    await page.getByRole('button', { name: /เริ่มแบบนี้ รายครั้ง/ }).click()

    // การเลือกแพ็กจากหน้า pricing ต้องเก็บ intent ไว้ แต่ยังคงเดโมจนกว่าครูยืนยันเริ่มใช้จริงเอง
    await expect(page).toHaveURL(/#\/app\/today$/)
    await expect(page.getByText(copy.demoBadge)).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('solo-demo-v3') ?? '{}') as { mode?: string; subjects?: unknown[] }
      return { mode: saved.mode, subjects: saved.subjects?.length ?? 0 }
    })).toEqual({ mode: 'demo', subjects: 6 })
    await page.getByRole('button', { name: copy.menu.title }).click()
    await page.getByRole('dialog', { name: copy.menu.title }).getByRole('button', { name: copy.menu.startReal }).click()
    await page.getByRole('dialog', { name: copy.menu.startReal }).getByRole('button', { name: copy.menu.startReal }).click()
    await expect(page).toHaveURL(/#\/app\/onboarding\?plan=3$/)

    const field = (label: string) => page.locator('.fld').filter({ hasText: label }).locator('input, textarea').first()
    await field(copy.onboarding.providerName).fill('ครูรายได้ QA')
    await field(copy.onboarding.promptpay).fill('0812345678')
    await page.getByRole('group', { name: copy.onboarding.particle }).getByRole('button', { name: 'ครับ' }).click()
    await page.getByRole('button', { name: copy.onboarding.next }).click()
    await field(copy.onboarding.pasteLabel).fill('น้องรายได้, ผู้ปกครองรายได้')
    await page.getByRole('button', { name: `${copy.onboarding.finish} (1)` }).click()
    await expect(page).toHaveURL(/#\/app\/settings\/account\?plan=3$/)

    await page.getByLabel('อีเมล').fill('teacher@example.com')
    await page.getByLabel('รหัสผ่าน').fill('qa-password')
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    const card = page.getByTestId('plan-card')
    await expect(card.getByRole('radio', { name: /3 เดือน/ })).toHaveAttribute('aria-checked', 'true')
    await card.getByRole('button', { name: /ส่งคำขอ/ }).click()
    await expect(card).toContainText(copy.plan.status.pending)
    expect(seen.planRequests[0]).toMatchObject({ months: 3, amount: 799, status: 'pending' })

    // จำลอง back office ตรวจยอดและอนุมัติ แล้วโหลดสถานะจาก server ใหม่
    seen.approveLatest()
    await page.reload()
    await expect(page.getByTestId('sync-status')).toHaveText(copy.account.status.synced, { timeout: 15_000 })
    await expect(card).toContainText(copy.plan.pro)
    await card.getByRole('button', { name: copy.plan.receipt }).click()
    const receipt = page.getByRole('dialog', { name: copy.plan.receiptTitle })
    await expect(receipt).toContainText('SP-202509-0001')
    await expect(receipt).toContainText('Solo Tutor QA (ข้อมูลสมมติ)')
    await receipt.getByRole('button', { name: copy.common.close }).click()

    await card.getByRole('button', { name: copy.plan.pause }).click()
    await page.getByRole('dialog', { name: copy.plan.pause }).getByRole('button', { name: copy.plan.pause }).click()
    await expect(card).toContainText(copy.plan.proPaused)

    // แม้วันหมดอายุเดิมผ่านไปขณะพัก ปุ่มใช้ต่อต้องยังอยู่และ server เป็นผู้เลื่อนวันใหม่
    seen.expireOriginalWhilePaused()
    await page.reload()
    await expect(card.getByRole('button', { name: copy.plan.resume })).toBeVisible()
    await card.getByRole('button', { name: copy.plan.resume }).click()
    await expect(card).toContainText(copy.plan.pro)

    seen.expirePlan()
    await page.reload()
    await expect(card).toContainText(copy.plan.proExpired)
    await page.goto('#/app/subjects')
    await expect(page.getByText('น้องรายได้')).toBeVisible()
    await page.getByRole('button', { name: copy.menu.title }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('dialog', { name: copy.menu.title }).getByRole('button', { name: copy.importer.exportMenu }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^รายชื่อ-.*\.csv$/)
  })
})
