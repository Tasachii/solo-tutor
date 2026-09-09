import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SCENARIOS, buildScenario } from '../../src/core/scenarios'
import { LINE_TEXT_LIMIT } from '../../src/core/share'
import { reducer } from '../../src/core/store'
import { messageSendIssue, oaDedupeKey } from '../../src/core/messageDelivery'
import { invoiceUrlOf, receiptUrlOf } from '../../src/core/messages'
import { validateState } from '../../src/core/validation'
import type { AppState, Message, OaDelivery } from '../../src/core/types'

/**
 * ชุด A-demo — สมุดตัวอย่างส่งผ่าน LINE OA จริงได้ (`docs/line-oa-v2-plan.md` §2, §4)
 *
 * หลักการที่เทสนี้เฝ้า: OA ขึ้นกับ **บัญชีครูที่ล็อกอิน + ช่อง OA + ผู้ปกครองที่จับคู่ด้วยรหัสของครูคนนั้น**
 * ไม่ขึ้นกับว่าสมุดเป็นเดโมหรือจริง · ข้อความจากเดโมจึงถึงได้เฉพาะเครื่องที่ครูคนนั้นจับคู่เอง
 * แต่ตัวเลขจากเดโมต้องไม่ปนกับของจริงในรายงาน และลิงก์ที่ออกไปต้องเปิดได้จากเครื่องอื่น
 */
const providerId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const recipientId = '33333333-3333-4333-8333-333333333333'

const linked = (mode: 'demo' | 'real'): AppState => reducer({
  ...buildScenario('default'), mode,
  ...(mode === 'real' ? { provider: { name: 'ครู QA', promptpayId: '0812345678' } } : {}),
  lineWorkspaceId: workspaceId, lineProviderId: providerId, sending: undefined,
}, { type: 'track', name: 'init' })

const aDraft = (state: AppState): Message => state.messages.find(m => m.status === 'draft')!
const intentFor = (state: AppState, message: Message): OaDelivery => ({
  providerId, workspaceId, recipientId, dedupeKey: oaDedupeKey(state, message), body: message.draft,
})

describe('คีย์กันส่งซ้ำแยกเดโมออกจากของจริง', () => {
  it('เดโมมี demo: นำหน้า · โหมดจริงไม่เปลี่ยนรูปแม้แต่ตัวอักษรเดียว', () => {
    const message = { dedupeKey: 'rem:inv-s2-2026-08:clear' }
    expect(oaDedupeKey({ mode: 'real', lineWorkspaceId: workspaceId }, message)).toBe(`${workspaceId}:rem:inv-s2-2026-08:clear`)
    expect(oaDedupeKey({ mode: 'demo', lineWorkspaceId: workspaceId }, message)).toBe(`${workspaceId}:demo:rem:inv-s2-2026-08:clear`)
  })

  it('ทั้งสี่จุดที่ประกอบคีย์ต้องเรียกตัวช่วยเดียวกัน ไม่ต่อสตริงเอง', () => {
    // พลาดจุดเดียว (เช่น findDelivery ใน Admin) = การกู้รายการที่ timeout ไปแล้วมองเป็นคนละใบ
    // แล้วครูจะส่งข้อความเดิมซ้ำถึงผู้ปกครองโดยไม่มีอะไรฟ้อง
    for (const file of ['src/app/oaSend.ts', 'src/core/store.tsx', 'src/core/validation.ts', 'src/app/Admin.tsx']) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toContain('oaDedupeKey')
      expect(source, file).not.toContain('lineWorkspaceId}:${')
    }
  })

  it("ทุกรายชื่อเหตุผล \"ล้มก่อนมีอะไรออกจากเครื่อง\" ต้องรวม offline ด้วย", () => {
    // `offline` = เครือข่ายล้มก่อนบันทึกรายการใด ๆ · ที่ใดที่ no-session ถือว่า "ลองต่อไปก็ผลเดิม"
    // ที่นั้นต้องคิดกับ offline เหมือนกัน ไม่งั้นส่งเป็นชุดบนไวไฟที่ตายจะไล่ทำเครื่องหมายล้มทุกใบ
    for (const file of ['src/app/LineMessageAction.tsx', 'src/app/AdminCollect.tsx']) {
      const line = readFileSync(file, 'utf8').split('\n').find(row => row.includes("'no-session'"))
      expect(line, file).toBeTruthy()
      expect(line, file).toContain("'offline'")
    }
  })

  it('เดโม: oaStart ที่ใช้คีย์แบบไม่มีคำนำหน้าถูกปฏิเสธ · คีย์ที่ถูกต้องผ่าน', () => {
    const state = linked('demo')
    const message = aDraft(state)
    const bare = { ...intentFor(state, message), dedupeKey: `${workspaceId}:${message.dedupeKey}` }
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery: bare })).toBe(state)
    const next = reducer(state, { type: 'oaStart', id: message.id, delivery: intentFor(state, message) })
    expect(next).not.toBe(state)
    expect(next.messages.find(m => m.id === message.id)!.oaDelivery!.dedupeKey).toBe(`${workspaceId}:demo:${message.dedupeKey}`)
  })

  it('โหมดจริง: คีย์เดิมยังผ่าน และคีย์ที่มีคำนำหน้า demo: ถูกปฏิเสธ', () => {
    const state = linked('real')
    const message = aDraft(state)
    const withPrefix = { ...intentFor(state, message), dedupeKey: `${workspaceId}:demo:${message.dedupeKey}` }
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery: withPrefix })).toBe(state)
    const next = reducer(state, { type: 'oaStart', id: message.id, delivery: intentFor(state, message) })
    expect(next.messages.find(m => m.id === message.id)!.oaDelivery!.dedupeKey).toBe(`${workspaceId}:${message.dedupeKey}`)
  })

  it('validateState รับรายการ OA ของเดโม แต่ปฏิเสธคีย์ที่ผิดโหมด', () => {
    const state = linked('demo')
    const message = aDraft(state)
    const queued = reducer(state, { type: 'oaStart', id: message.id, delivery: intentFor(state, message) })
    expect(validateState(queued).ok).toBe(true)
    const tampered = {
      ...queued,
      messages: queued.messages.map(m => m.oaDelivery
        ? { ...m, oaDelivery: { ...m.oaDelivery, dedupeKey: `${workspaceId}:${m.dedupeKey}` } } : m),
    }
    const result = validateState(tampered)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.some(e => e.includes('oaDelivery'))).toBe(true)
  })
})

describe('ด่านก่อนส่งในโหมดเดโม', () => {
  it('ลิงก์ที่เปิดได้เฉพาะเครื่องนี้ถูกกันในเดโมด้วย ไม่ใช่แค่โหมดจริง', () => {
    // เดโมส่งถึงมือถือผู้ปกครองได้แล้ว ลิงก์ `#/client/…` จะโชว์ข้อมูลของเครื่องผู้รับ ไม่ใช่ของครู
    const state = linked('demo')
    const message = { ...aDraft(state), draft: 'ดูรายละเอียดที่ https://x.test/#/client/c1', edited: true }
    expect(messageSendIssue(state, message)).toContain('เปิดได้เฉพาะเครื่องนี้')
    expect(messageSendIssue(state, { ...message, draft: 'ใบเสร็จ https://x.test/#/receipt/r1' })).toContain('เปิดได้เฉพาะเครื่องนี้')
  })

  it('เดโมยังข้ามด่านยอดเปลี่ยนหลังร่าง — refreshDemoDay เดินวันทุกวัน ร่างที่แคชคืนก่อนพิทช์ต้องส่งได้', () => {
    const state = linked('demo')
    const message = aDraft(state)
    const stale = { ...message, meta: { ...message.meta, financialRevision: 'v1:deadbeefdeadbeef' } }
    expect(messageSendIssue(state, stale)).toBeNull()
    // โหมดจริงต้องยังกันอยู่ ไม่ได้ถูกปลดไปด้วย
    const real = linked('real')
    const realStale = { ...aDraft(real), meta: { ...aDraft(real).meta, financialRevision: 'v1:deadbeefdeadbeef' } }
    expect(messageSendIssue(real, realStale)).toContain('สร้างข้อความจากยอดล่าสุด')
  })

  it('เดโมยังข้ามด่านชื่อผู้รับเงิน/พร้อมเพย์ — เลขในเดโมเป็นค่าตัวอย่างโดยเจตนา', () => {
    const state = { ...linked('demo'), provider: { name: '', promptpayId: '08x-xxx-xxxx' } }
    const message = state.messages.find(m => m.status === 'draft' && m.kind === 'reminder')
      ?? state.messages.find(m => m.status === 'draft')!
    expect(messageSendIssue(state, message)).toBeNull()
  })

  it('ด่านที่ทุกโหมดใช้ร่วมกันยังทำงานในเดโม', () => {
    const state = linked('demo')
    const message = aDraft(state)
    expect(messageSendIssue(state, { ...message, draft: '   ' })).toContain('เขียนข้อความก่อนส่ง')
    expect(messageSendIssue(state, { ...message, clientId: 'ไม่มีคนนี้' })).toContain('ไม่พบผู้รับข้อความ')
  })
})

describe('ลิงก์ในข้อความของเดโมเปิดได้จากเครื่องอื่น', () => {
  it('บิลและใบเสร็จออกลิงก์เอกสาร (token) แบบเดียวกับโหมดจริง', () => {
    const demo = buildScenario('default')
    const invoice = demo.invoices[0]
    const url = invoiceUrlOf(invoice.clientId, demo, invoice.id)
    expect(url).toContain('#/document/')
    expect(url).not.toContain('#/client/')
    const receiptUrl = receiptUrlOf(demo.receipts[0].id, demo)
    expect(receiptUrl).toContain('#/document/')
    expect(receiptUrl).not.toContain('#/receipt/')
  })

  it('ร่างและใบเสร็จที่ seed ไว้ไม่มีลิงก์รุ่นเดิมเหลืออยู่เลยในทุกชุดข้อมูล', async () => {
    const { SCENARIOS } = await import('../../src/core/scenarios')
    for (const id of SCENARIOS) {
      const state = reducer(buildScenario(id), { type: 'track', name: 'init' })
      for (const message of state.messages) {
        expect(message.draft, `${id}/${message.dedupeKey}`).not.toMatch(/#\/(client|receipt)\//)
      }
    }
  })

  it('ไม่มีข้อความไหนสัญญาลิงก์แล้วได้ประโยค "ติดต่อผู้ให้บริการ" มาต่อท้ายแทน', async () => {
    // เกิดจริงตอนเปลี่ยนลิงก์เดโม: ใบต่อแพ็กยังไม่มีบิล จึงไม่มีเอกสารให้ลิงก์ แล้วข้อความกลายเป็น
    // "ดูรายละเอียดได้ที่ ติดต่อผู้ให้บริการในแชทนี้เพื่อขอรายละเอียด" ซึ่งอ่านไม่รู้เรื่อง
    const { SCENARIOS } = await import('../../src/core/scenarios')
    for (const id of SCENARIOS) {
      for (const mode of ['demo', 'real'] as const) {
        const seed = { ...buildScenario(id), mode, ...(mode === 'real' ? { provider: { name: 'ครู QA', promptpayId: '0812345678' } } : {}) }
        for (const message of reducer(seed, { type: 'track', name: 'init' }).messages) {
          expect(message.draft, `${id}/${mode}/${message.dedupeKey}`).not.toContain('ติดต่อผู้ให้บริการ')
        }
      }
    }
  })

  it('ชุดข้อมูลเริ่มต้นยังเล็กพอที่จะเก็บใน localStorage ได้สบาย', () => {
    // ลิงก์เอกสารพาข้อมูลไปในตัว URL — ใบเสร็จที่ seed ไว้จึงยาวขึ้น วัดไว้กันโตเงียบ ๆ
    expect(JSON.stringify(buildScenario('default')).length).toBeLessThan(200_000)
  })

  it('ทุกร่าง/ข้อความที่ seed ไว้ในทุกชุดข้อมูล ยังสั้นกว่าที่ LINE รับได้ แม้ลิงก์เป็น token เอกสารแล้ว', () => {
    // documentUrl ยอมให้ token ยาวถึง 16000 แต่ messageSendIssue ปฏิเสธเกิน 5000 — ต้องไม่มีร่างไหนติดตรงกลาง
    for (const id of SCENARIOS) {
      for (const m of buildScenario(id).messages) {
        expect(m.draft.length, `${id}:${m.id}`).toBeLessThanOrEqual(LINE_TEXT_LIMIT)
      }
    }
  })
})
