import { expect, test, type Page } from './fixtures'

test.skip(process.env.SOLO_LINE_QA !== '1', 'LINE OA mock E2E runs only in the isolated QA command')

const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'
const remoteClientId = '44444444-4444-4444-8444-444444444444'
const outboxId = '55555555-5555-4555-8555-555555555555'
const projectOrigin = 'https://line-qa.supabase.co'
const messageText = 'ข้อความทดสอบ LINE OA ถึงผู้ปกครอง'

type MockOptions = { connected?: boolean; linked?: boolean; timeoutAfterEnqueue?: boolean }

const installMockBackend = async (page: Page, options: MockOptions = {}) => {
  const state = {
    connected: options.connected ?? false,
    linked: options.linked ?? false,
    timeoutAfterEnqueue: options.timeoutAfterEnqueue ?? false,
    outboxStatus: '' as '' | 'queued' | 'processing' | 'sent',
    enqueueCount: 0,
    lineSendCount: 0,
    snapshotSaves: 0,
    handled: [] as string[],
    escaped: [] as string[],
  }

  page.on('request', request => {
    const url = new URL(request.url())
    const isSupabase = url.hostname.endsWith('.supabase.co')
    const isLine = url.hostname === 'line.me' || url.hostname.endsWith('.line.me') || url.hostname === 'api.line.me'
    if ((isSupabase && url.origin !== projectOrigin) || isLine) state.escaped.push(request.url())
  })

  await page.route(`${projectOrigin}/**`, async route => {
    const request = route.request()
    const url = new URL(request.url())
    state.handled.push(`${request.method()} ${url.pathname}`)
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const credentials = request.postDataJSON() as { email: string; password: string }
      expect(credentials).toEqual({ email: 'teacher@example.com', password: 'qa-password' })
      return json({
        access_token: 'qa-user-jwt', refresh_token: 'qa-refresh-token', expires_in: 3600,
        user: { id: providerId, email: 'teacher@example.com' },
      })
    }
    // ซิงก์คลาวด์ทำงานเบื้องหลังหลังเข้าสู่ระบบ — เทสนี้สนใจ LINE จึงตอบว่าว่างและรับ push ไว้เฉย ๆ
    // ตัวนับการใช้งานและรายงานข้อผิดพลาดยิงจากทุกหน้า — รับไว้เฉย ๆ ไม่ใช่เรื่องของเทสนี้
    if (url.pathname === '/functions/v1/usage' || url.pathname === '/functions/v1/report-error') return json({ ok: true })
    if (url.pathname === '/rest/v1/ledger_snapshots' && request.method() === 'GET') return json([])
    if (url.pathname === '/rest/v1/rpc/save_ledger_snapshot') {
      state.snapshotSaves += 1
      return json([{ ok: true, revision: state.snapshotSaves, updated_at: '2026-09-07T00:00:00Z' }])
    }
    if (url.pathname === '/rest/v1/line_channel_public' && request.method() === 'GET') {
      return json(state.connected ? [{
        status: 'active', display_name: 'Solo Tutor QA', basic_id: '@solotutorqa',
        quota_used: 2, quota_limit: 300, quota_month: '2026-09', last_verified_at: '2026-09-07T00:00:00Z',
      }] : [])
    }
    if (url.pathname === '/rest/v1/rpc/line_delivery_target') {
      const body = request.postDataJSON() as { p_local_client_key: string }
      return json([{
        client_id: remoteClientId,
        recipient_id: state.linked && body.p_local_client_key === 'c1' ? recipientId : null,
        channel_status: state.connected ? 'active' : null,
        eligible: state.connected && state.linked && body.p_local_client_key === 'c1', reason: 'ok',
        unfollowed_at: null, quota_used: 2, quota_limit: 300,
      }])
    }
    if (url.pathname === '/functions/v1/line-connect') {
      expect(request.postDataJSON()).toEqual({ channelSecret: 'qa-channel-secret', accessToken: 'qa-access-token' })
      state.connected = true
      return json({ ok: true, displayName: 'Solo Tutor QA' })
    }
    if (url.pathname === '/rest/v1/rpc/sync_line_workspace_clients') {
      const body = request.postDataJSON() as { p_workspace_key: string; p_clients: { id: string }[] }
      expect(body.p_workspace_key).toBe(workspaceId)
      return json(body.p_clients.map(client => ({
        local_client_key: client.id,
        client_id: client.id === 'c1' ? remoteClientId : crypto.randomUUID(),
      })))
    }
    if (url.pathname === '/rest/v1/rpc/issue_line_link_code') {
      expect(request.postDataJSON()).toEqual({ p_client_id: remoteClientId })
      return json([{ code: '123456', expires_at: '2026-09-08T00:00:00Z' }])
    }
    if (url.pathname === '/rest/v1/message_outbox' && request.method() === 'GET') {
      if (!state.outboxStatus) return json([])
      return json([{
        id: outboxId, status: state.outboxStatus, recipient_id: recipientId,
        body: messageText, message_id: 'qa-message-key', last_error: null,
      }])
    }
    if (url.pathname === '/rest/v1/rpc/enqueue_line_message') {
      const body = request.postDataJSON() as Record<string, string>
      expect(body).toMatchObject({
        p_recipient_id: recipientId,
        p_message_id: 'qa-message-key',
        p_body: messageText,
        p_dedupe_key: `${workspaceId}:qa-message-key`,
      })
      state.enqueueCount += 1
      if (!state.outboxStatus) state.outboxStatus = 'queued'
      return json(outboxId)
    }
    if (url.pathname === '/functions/v1/line-send') {
      expect(request.postDataJSON()).toEqual({ outboxId })
      state.lineSendCount += 1
      state.outboxStatus = 'sent'
      if (state.timeoutAfterEnqueue) {
        // Keep the gateway request pending beyond the browser transport's 12-second bound.
        // The simulated server has already accepted the send, so reconciliation must not push again.
        await new Promise(resolve => setTimeout(resolve, 13_000))
        try { return await json({ ok: true }) } catch { return }
      }
      return json({ ok: true })
    }
    throw new Error(`Unhandled mock Supabase request: ${request.method()} ${url.pathname}${url.search}`)
  })
  return state
}

const seedRealWorkspace = async (page: Page) => {
  await page.goto('?scenario=default#/app/admin')
  await expect(page.locator('.skel')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('solo-demo-v3'))).not.toBeNull()
  await page.evaluate(({ providerId: provider, workspaceId: workspace, messageText: text }) => {
    const saved = JSON.parse(localStorage.getItem('solo-demo-v3')!)
    saved.mode = 'real'
    saved.scenarioId = 'real'
    saved.onboarded = true
    saved.provider = { name: 'ครู QA', promptpayId: '0812345678' }
    saved.lineWorkspaceId = workspace
    saved.lineProviderId = provider
    saved.sending = undefined
    saved.messages = [{
      id: 'qa-line-message', clientId: 'c1', kind: 'faq_reply', draft: text, edited: true,
      status: 'draft', createdAt: saved.today, dedupeKey: 'qa-message-key',
      meta: { answerFrom: 'schedule', question: 'ขอเวลาคาบเรียน' },
    }]
    localStorage.setItem('solo-demo-v3', JSON.stringify(saved))
  }, { providerId, workspaceId, messageText })
}

const login = async (page: Page) => {
  await page.goto('#/app/settings/line')
  await page.getByLabel('อีเมล').fill('teacher@example.com')
  await page.getByLabel('รหัสผ่าน').fill('qa-password')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page.getByText('teacher@example.com')).toBeVisible()
}

test('เชื่อม OA ล้าง credentials สร้างรหัส จับคู่ผู้ปกครอง และยืนยันส่งในเครื่องเมื่อ server ส่งสำเร็จ', async ({ page }) => {
  const backend = await installMockBackend(page)
  await seedRealWorkspace(page)
  await login(page)
  await expect(page.getByText('ยังไม่ได้เชื่อมบัญชี')).toBeVisible()

  await page.getByLabel('Channel secret').fill('qa-channel-secret')
  await page.getByLabel('Channel access token').fill('qa-access-token')
  await page.getByRole('button', { name: 'เชื่อมบัญชี OA' }).click()
  await expect(page.getByLabel('Channel secret')).toHaveValue('')
  await expect(page.getByLabel('Channel access token')).toHaveValue('')
  await expect(page.getByText('เชื่อมต่อแล้ว')).toBeVisible()

  const parent = page.locator('.line-parent').filter({ hasText: 'คุณแม่แพรว' })
  await parent.getByRole('button', { name: 'สร้างรหัสเชื่อม' }).click()
  await expect(parent).toContainText('123456')
  backend.linked = true
  await page.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง' }).click()
  await expect(parent).toContainText('เชื่อมแล้ว')
  const screenshot = (page.viewportSize()?.width ?? 1280) < 700 ? 'line-settings-mobile.png' : 'line-settings.png'
  await page.screenshot({ path: `/Users/tasachi/Documents/solo-tutor-qa-20260907/${screenshot}`, fullPage: true })

  await page.goto('#/app/admin')
  const card = page.locator('.msg').filter({ hasText: messageText })
  await card.getByRole('button', { name: 'ส่งด้วย LINE OA' }).click()
  await expect(card).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('solo-demo-v3')!)
    const message = state.messages.find((row: { id: string }) => row.id === 'qa-line-message')
    return { status: message?.status, oaDelivery: message?.oaDelivery }
  })).toEqual({ status: 'sent', oaDelivery: undefined })

  expect(backend.enqueueCount).toBe(1)
  expect(backend.lineSendCount).toBe(1)
  expect(backend.handled.length).toBeGreaterThan(0)
  expect(backend.escaped).toEqual([])
})

test('timeout หลังเข้าคิวเก็บ marker ข้าม reload ปิดแชร์ส่วนตัว และ reconcile โดยไม่ push ซ้ำ', async ({ page }) => {
  const backend = await installMockBackend(page, { connected: true, linked: true, timeoutAfterEnqueue: true })
  await seedRealWorkspace(page)
  await login(page)
  await page.goto('#/app/admin')

  let card = page.locator('.msg').filter({ hasText: messageText })
  await card.getByRole('button', { name: 'ส่งด้วย LINE OA' }).click()
  await expect(card).toContainText('รอตรวจสอบ')
  await expect(card).toContainText('ติดต่อระบบ OA ไม่สำเร็จ', { timeout: 15_000 })
  await expect(card.getByRole('button', { name: 'ส่งใน LINE' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('solo-demo-v3')!)
    return !!state.messages.find((row: { id: string }) => row.id === 'qa-line-message')?.oaDelivery
  })).toBe(true)

  await page.reload()
  await expect(page.locator('.skel')).toHaveCount(0)
  card = page.locator('.msg').filter({ hasText: messageText })
  await expect(card).toContainText('รอตรวจสอบ')
  await expect(card.getByRole('button', { name: 'ส่งใน LINE' })).toHaveCount(0)
  await card.getByRole('button', { name: 'ตรวจสอบผลส่ง LINE OA' }).click()
  await expect(card).toHaveCount(0)

  expect(backend.enqueueCount).toBe(1)
  expect(backend.lineSendCount).toBe(1)
  expect(backend.escaped).toEqual([])
})


test('ตรวจรายการ processing หลัง worker หยุด โดยเรียก targeted send เดิมให้เซิร์ฟเวอร์กู้ claim ได้', async ({ page }) => {
  const backend = await installMockBackend(page, { connected: true, linked: true })
  await seedRealWorkspace(page)
  await login(page)
  backend.outboxStatus = 'processing'
  await page.goto('#/app/admin')
  const card = page.locator('.msg').filter({ hasText: messageText })
  await card.getByRole('button', { name: 'ส่งด้วย LINE OA' }).click()
  await expect(card).toHaveCount(0)
  expect(backend.lineSendCount).toBe(1)
  expect(backend.enqueueCount).toBe(1)
  expect(backend.escaped).toEqual([])
})
