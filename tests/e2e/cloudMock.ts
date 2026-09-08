import type { Page } from './fixtures'

/**
 * Supabase จำลองสำหรับ e2e ที่ build ด้วย VITE_SUPABASE_URL=https://line-qa.supabase.co (SOLO_LINE_QA=1)
 * ใช้ร่วมกันโดย account.spec และ login.spec — auth/token, ledger_snapshots, save_ledger_snapshot, แพ็ก และตัวนับการใช้งาน
 */
/** ส่วนที่คุยกับ Supabase จำลอง — รันเฉพาะคำสั่ง QA ที่ build ด้วย VITE_SUPABASE_URL=https://line-qa.supabase.co */
export const projectOrigin = 'https://line-qa.supabase.co'
export const providerId = '11111111-1111-4111-8111-111111111111'

export const installCloud = async (page: Page, head: { revision: number; cipher?: string; iv?: string; kdf?: string } | null) => {
  const planRequests: Record<string, unknown>[] = []
  /** ลิงก์เอกสารที่ครูจำลองเผยแพร่ไว้ — เก็บสถานะจริงเพื่อให้การตรวจว่ายังเปิดได้อยู่ไหมตอบถูก */
  const sharedDocuments: Record<string, unknown>[] = []
  /** การคืนเงินที่ทีมบันทึกไว้ฝั่งเซิร์ฟเวอร์ ปกติว่าง — เทสที่ต้องการค่อย push ยอดสมมติเข้ามา */
  const planRefunds: Record<string, unknown>[] = []
  let snapshot: Record<string, unknown> | null = head
    ? { revision: head.revision, schema_version: 5, cipher: head.cipher ?? 'bm90LXJlYWw=', iv: head.iv ?? 'aXY=', kdf: head.kdf ?? 'pbkdf2-sha256-310000', updated_at: '2026-09-07T01:00:00Z', device: 'iPhone/iPad' }
    : null
  let providerPlan = { plan: 'free', plan_until: null as string | null, paused_at: null as string | null }
  const seen = {
    saves: [] as Record<string, unknown>[], reads: 0, planRequests,
    deletions: 0, deletionStatus: 200, sharedDocuments, planRefunds,
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
    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup') {
      // สมัครและเข้าสู่ระบบได้ session ทันที (โปรเจกต์จริงต้องปิด "Confirm email" ให้ตรงกัน)
      const email = ((request.postDataJSON() as { email?: string } | null)?.email) ?? 'teacher@example.com'
      return json({ access_token: 'qa-jwt', refresh_token: 'qa-refresh', expires_in: 3600, user: { id: providerId, email } })
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
    // การคืนเงินอ่านจากหลักฐานฝั่งเซิร์ฟเวอร์เท่านั้น (D-08) — ไม่มีรายการ = ไม่มีการคืนเงิน
    if (url.pathname === '/rest/v1/rpc/list_plan_refunds') return json(planRefunds)
    if (url.pathname === '/rest/v1/rpc/pause_plan') {
      providerPlan = { ...providerPlan, paused_at: '2025-09-02T10:30:00+07:00' }
      return json([providerPlan])
    }
    if (url.pathname === '/rest/v1/rpc/resume_plan') {
      providerPlan = { plan: 'pro', plan_until: '2025-10-03', paused_at: null }
      return json([providerPlan])
    }
    if (url.pathname === '/rest/v1/line_channel_public') return json([])
    // รายการลิงก์ของครู และการตรวจก่อนใช้ลิงก์เดิมซ้ำ (`?token=eq.<token>`) ใช้ปลายทางเดียวกัน
    // RLS จริงกรองให้เหลือแต่ของครูคนนี้ ที่นี่จึงคืนทุกแถวที่ครูจำลองเผยแพร่ไว้
    if (url.pathname === '/rest/v1/shared_documents') {
      const wanted = url.searchParams.get('token')?.replace(/^eq\./, '')
      return json(wanted ? sharedDocuments.filter((row) => row.token === wanted) : sharedDocuments)
    }
    // ลิงก์เอกสารที่ปิดได้ — ครูเผยแพร่ก่อนข้อความออกจากเบราว์เซอร์ ทุกการส่งบิลจึงผ่านทางนี้
    if (url.pathname === '/rest/v1/rpc/publish_shared_document') {
      const body = request.postDataJSON() as Record<string, unknown>
      // token ต้องเป็น base64url 22 ตัวเหมือนของจริง ไม่งั้นฝั่งผู้รับจะปฏิเสธรูปแบบลิงก์
      const token = `qa-token-${String(sharedDocuments.length + 1).padStart(3, '0')}`.padEnd(22, 'x')
      const expires = typeof body.p_expires_at === 'string' ? body.p_expires_at : '2030-01-01T00:00:00Z'
      sharedDocuments.push({
        token, kind: body.p_kind, cipher: body.p_cipher, iv: body.p_iv,
        label: body.p_label ?? null, label_iv: body.p_label_iv ?? null,
        created_at: '2025-09-02T03:00:00Z', expires_at: expires, revoked_at: null,
      })
      return json([{ token, expires_at: expires }])
    }
    // เพิกถอน = ปิดการเปิดครั้งต่อไป · คืน false เมื่อไม่มีอะไรเปลี่ยน เหมือนฟังก์ชันจริง
    if (url.pathname === '/rest/v1/rpc/revoke_shared_document') {
      const wanted = (request.postDataJSON() as { p_token?: string } | null)?.p_token
      const row = sharedDocuments.find((entry) => entry.token === wanted && entry.revoked_at === null)
      if (row) row.revoked_at = '2025-09-02T04:00:00Z'
      return json(!!row)
    }
    throw new Error(`Unhandled mock Supabase request: ${request.method()} ${url.pathname}`)
  })
  return seen
}
