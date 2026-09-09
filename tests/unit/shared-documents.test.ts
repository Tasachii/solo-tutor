import { afterEach, describe, expect, it, vi } from 'vitest'
import { signIn, signOut } from '../../src/integrations/supabaseRest'
import { buildScenario } from '../../src/core/scenarios'
import { documentUrl, invoiceDocument, readDocument, receiptDocument, type SharedDocument } from '../../src/core/documents'
import {
  DEFAULT_SHARE_DAYS, MAX_SHARE_DAYS, documentLabel, documentLinkFor, exportUrlKey, generateDocumentKey,
  importUrlKey, openDocument, openLabel, parseDocumentRoute, sealDocument, sealLabel, shareExpiryFrom,
} from '../../src/core/documentShare'
import { listSharedDocuments, resolveSharedDocument, revokeSharedDocument } from '../../src/core/sharedDocumentApi'
import { forgetLink, rememberedLink, secureDraft } from '../../src/core/documentPublish'
import { deriveKey } from '../../src/core/cloudCrypto'
import { rememberKey } from '../../src/core/cloudKey'

const projectUrl = 'https://project-ref.supabase.co'
const userId = '11111111-1111-4111-8111-111111111111'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
/** พ้นวันหมดอายุที่ตรึงไว้ในเทส (2025-09-02) ไปไกลพอ */
const LATER = '2025-12-01T02:00:00Z'
const authBody = { access_token: 'access-one', refresh_token: 'refresh-one', expires_in: 3600, user: { id: userId, email: 't@example.com' } }

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); signOut(); vi.unstubAllEnvs() })

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
}
const login = async () => {
  configure()
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(authBody))
  await signIn('t@example.com', 'password')
  return fetchMock
}

const realState = () => {
  const state = buildScenario('default')
  return { ...state, mode: 'real' as const }
}
const anInvoice = (): { doc: SharedDocument; draft: string } => {
  const state = realState()
  const doc = invoiceDocument(state, state.invoices[0].id)!
  return { doc, draft: `เรียนคุณแม่ ดูรายละเอียดที่ ${documentUrl(doc)} ขอบคุณค่ะ` }
}

describe('รูปแบบลิงก์เอกสาร', () => {
  it('กุญแจอยู่หลัง # เสมอ จึงไม่ถูกส่งไปกับคำขอ HTTP ใด', () => {
    const link = documentLinkFor('A'.repeat(22), 'k'.repeat(43))
    const fragment = link.slice(link.indexOf('#'))
    expect(fragment).toBe(`#/document/${'A'.repeat(22)}.${'k'.repeat(43)}`)
    // ทุกอย่างก่อน # คือส่วนที่เดินทางไปเซิร์ฟเวอร์ ต้องไม่มีทั้ง token และกุญแจอยู่ในนั้น
    expect(link.slice(0, link.indexOf('#'))).not.toContain('k'.repeat(43))
    expect(new URL(link).pathname).not.toContain('k'.repeat(43))
  })

  it('แยกลิงก์รุ่นใหม่กับรุ่นเดิมได้ และรูปแบบที่ผิดต้องล้มแบบปิด ไม่ตกไปเดาว่าเป็นรุ่นเดิม', () => {
    const token = 'A'.repeat(22)
    const key = 'k'.repeat(43)
    expect(parseDocumentRoute(`${token}.${key}`)).toEqual({ secure: { token, key }, legacy: null })
    expect(parseDocumentRoute('eyJ2IjoxfQ')).toEqual({ secure: null, legacy: 'eyJ2IjoxfQ' })
    for (const bad of [
      '', `${token}.`, `.${key}`, `${token}.${key}.extra`, `${'A'.repeat(21)}.${key}`,
      `${token}.${'k'.repeat(42)}`, `${token}.${'k'.repeat(44)}`, `${token}.${'!'.repeat(43)}`,
    ]) {
      expect(parseDocumentRoute(bad)).toEqual({ secure: null, legacy: null })
    }
  })

  it('อายุลิงก์เริ่มต้น 90 วัน และขอเกินเพดานไม่ได้', () => {
    const now = new Date('2025-09-02T09:00:00+07:00')
    const days = (iso: string) => Math.round((Date.parse(iso) - now.getTime()) / 86_400_000)
    expect(days(shareExpiryFrom(now))).toBe(DEFAULT_SHARE_DAYS)
    expect(days(shareExpiryFrom(now, 3650))).toBe(MAX_SHARE_DAYS)
    expect(days(shareExpiryFrom(now, -5))).toBe(1)
  })
})

describe('การเข้ารหัสเอกสาร', () => {
  it('กุญแจต่อใบเป็น base64url 43 ตัว ถอดกลับได้ และ ciphertext ไม่มีชื่อผู้จ่าย', async () => {
    const { doc } = anInvoice()
    const key = await generateDocumentKey()
    const urlKey = await exportUrlKey(key)
    expect(urlKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const sealed = await sealDocument(key, doc)
    expect(sealed.cipher).not.toContain(doc.payer)
    expect(sealed.cipher).not.toContain(doc.destination)
    const reopened = await openDocument((await importUrlKey(urlKey))!, sealed)
    expect(reopened).toEqual(doc)
  })

  it('ciphertext ที่ถูกแก้ กุญแจผิด และเนื้อในที่ยอดไม่ตรง ต้องได้ null ไม่ใช่เอกสารที่อ่านได้', async () => {
    const { doc } = anInvoice()
    const key = await generateDocumentKey()
    const sealed = await sealDocument(key, doc)
    const flipped = sealed.cipher.slice(0, -4) + (sealed.cipher.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(await openDocument(key, { ...sealed, cipher: flipped })).toBeNull()
    expect(await openDocument(key, { ...sealed, iv: 'AAAAAAAAAAAAAAAA' })).toBeNull()
    expect(await openDocument(await generateDocumentKey(), sealed)).toBeNull()
    // ถอดรหัสผ่านแต่ยอดรวมไม่ตรงรายการ = ยังต้องปฏิเสธ ไม่ใช่แสดงยอดที่ถูกแก้
    const forged = await sealDocument(key, { ...doc, total: doc.total + 100 })
    expect(await openDocument(key, forged)).toBeNull()
    expect(await importUrlKey('too-short')).toBeNull()
  })

  it('ป้ายชื่อของครูเข้ารหัสด้วยกุญแจคลาวด์ ไม่ใช่กุญแจของลิงก์', async () => {
    const { doc } = anInvoice()
    const cloudKey = await deriveKey('teacher-secret', userId)
    const label = documentLabel(doc)
    expect(label).toContain(doc.payer)
    const sealed = await sealLabel(cloudKey, label)
    expect(sealed.cipher).not.toContain(doc.payer)
    expect(await openLabel(cloudKey, sealed)).toBe(label)
    expect(await openLabel(await deriveKey('wrong', userId), sealed)).toBeNull()
  })
})

describe('การเผยแพร่ลิงก์ก่อนข้อความออกจากเครื่อง', () => {
  it('เปลี่ยนลิงก์ในข้อความเป็นลิงก์ที่เพิกถอนได้ ส่งขึ้นเซิร์ฟเวอร์แต่ ciphertext และไม่เคยส่งกุญแจ', async () => {
    const fetchMock = await login()
    await rememberKey(userId, await deriveKey('teacher-secret', userId))
    const { doc, draft } = anInvoice()
    const token = 'T'.repeat(22)
    fetchMock.mockResolvedValueOnce(json([{ token, expires_at: '2025-12-01T02:00:00Z' }]))

    const result = await secureDraft(realState(), draft)
    expect(result.skipped).toBeNull()
    expect(result.links).toHaveLength(1)
    const urlKey = result.links[0].key
    expect(urlKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.draft).toContain(`#/document/${token}.${urlKey}`)
    expect(result.draft).not.toContain(documentUrl(doc))

    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toContain('/rest/v1/rpc/publish_shared_document')
    const body = JSON.parse(String(init?.body)) as Record<string, string>
    expect(body.p_kind).toBe('invoice')
    expect(body.p_cipher).not.toContain(doc.payer)
    expect(body.p_label).toBeTruthy()
    expect(body.p_label).not.toContain(doc.payer)
    expect(Date.parse(body.p_expires_at)).toBeGreaterThan(Date.now())

    // กุญแจต้องไม่โผล่ในคำขอไหนเลย ทั้งใน URL, header และ body
    for (const [requestUrl, requestInit] of fetchMock.mock.calls) {
      const headers = new Headers(requestInit?.headers)
      const seen = `${String(requestUrl)} ${String(requestInit?.body ?? '')} ${[...headers].join(' ')}`
      expect(seen).not.toContain(urlKey)
    }
  })

  it('ส่งใบเดิมซ้ำใช้ลิงก์เดิมที่ยังเปิดได้ ไม่สร้างแถวใหม่ทุกครั้งที่กด', async () => {
    const fetchMock = await login()
    const { draft } = anInvoice()
    fetchMock.mockResolvedValueOnce(json([{ token: 'U'.repeat(22), expires_at: LATER }]))
    const first = await secureDraft(realState(), draft)
    // รอบสองตรวจก่อนว่าใบเดิมยังไม่ถูกปิด แล้วจึงใช้ซ้ำ
    fetchMock.mockResolvedValueOnce(json([{ token: 'U'.repeat(22), expires_at: LATER, revoked_at: null }]))
    const second = await secureDraft(realState(), draft)
    expect(second.draft).toBe(first.draft)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('publish_shared_document'))).toHaveLength(1)
    expect(rememberedLink(userId, 'U'.repeat(22))).toBe(first.draft.match(/https?:\/\/\S+/)![0])
    forgetLink(userId, 'U'.repeat(22))
    expect(rememberedLink(userId, 'U'.repeat(22))).toBeNull()
  })

  it('ใบเดิมในเครื่องที่ถูกปิดไปจากอีกเครื่องต้องไม่ถูกใช้ซ้ำ ต้องออกใบใหม่แทน', async () => {
    const fetchMock = await login()
    const { draft } = anInvoice()
    fetchMock.mockResolvedValueOnce(json([{ token: 'U'.repeat(22), expires_at: LATER }]))
    await secureDraft(realState(), draft)
    // อีกเครื่องกดปิดไปแล้ว — เพดานเวลาในเครื่องนี้ยังไม่หมดอายุ แต่ลิงก์ตายแล้ว
    fetchMock.mockResolvedValueOnce(json([{ token: 'U'.repeat(22), expires_at: LATER, revoked_at: '2025-09-02T00:00:00Z' }]))
    fetchMock.mockResolvedValueOnce(json([{ token: 'V'.repeat(22), expires_at: LATER }]))
    const again = await secureDraft(realState(), draft)
    expect(again.skipped).toBeNull()
    expect(again.draft).toContain('V'.repeat(22))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('publish_shared_document'))).toHaveLength(2)
  })

  it('ใบเสร็จก็ได้ลิงก์ที่เพิกถอนได้เหมือนกัน และ kind ถูกส่งตามชนิดเอกสาร', async () => {
    const fetchMock = await login()
    const state = realState()
    const doc = receiptDocument(state, state.receipts[0].id)!
    fetchMock.mockResolvedValueOnce(json([{ token: 'R'.repeat(22), expires_at: '2025-12-01T02:00:00Z' }]))
    const result = await secureDraft(state, `ใบเสร็จ: ${documentUrl(doc)}`)
    expect(result.skipped).toBeNull()
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).p_kind).toBe('receipt')
  })

  it('ไม่ได้ตั้งค่าโปรเจกต์ ยังไม่เข้าสู่ระบบ หรือเซิร์ฟเวอร์ปฏิเสธ → ข้อความเดิมไม่ถูกแตะ', async () => {
    const { draft } = anInvoice()
    // เดโมไม่มีทางแยกของตัวเองแล้ว (เคยคืน skipped: 'demo') — เดินบันไดเดียวกับโหมดจริงทุกขั้น
    const demo = buildScenario('default')
    expect(await secureDraft(demo, draft)).toEqual({ draft, links: [], skipped: 'not-configured' })

    expect(await secureDraft(realState(), draft)).toEqual({ draft, links: [], skipped: 'not-configured' })

    configure()
    expect(await secureDraft(realState(), draft)).toEqual({ draft, links: [], skipped: 'signed-out' })

    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json({ message: 'boom' }, 500))
    expect(await secureDraft(realState(), draft)).toEqual({ draft, links: [], skipped: 'failed' })
  })

  it('เดโมที่ล็อกอินแล้ว เผยแพร่ลิงก์ที่เพิกถอนได้เหมือนโหมดจริง (เกณฑ์ผ่านชุด A-demo)', async () => {
    // ข้อความจากสมุดตัวอย่างถึงมือถือผู้ปกครองได้แล้ว ลิงก์ที่ออกไปจึงต้องปิดได้เหมือนกัน
    // ไม่ใช่ลิงก์ถาวรที่มีชื่อเด็กและยอดเงินอยู่ในตัว URL ตลอดไป
    const fetchMock = await login()
    const demo = buildScenario('default')
    const { draft } = anInvoice()
    fetchMock.mockResolvedValueOnce(json([{ token: 'D'.repeat(22), expires_at: LATER }]))
    const result = await secureDraft(demo, draft)
    expect(result.skipped).toBeNull()
    expect(result.draft).toContain('D'.repeat(22))
    expect(result.links).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('publish_shared_document'))).toHaveLength(1)
  })

  it('ข้อความที่ไม่มีลิงก์เอกสารไม่ถูกเผยแพร่อะไรเลย', async () => {
    const fetchMock = await login()
    const plain = 'เรียนคุณแม่ พรุ่งนี้หยุดเรียนนะคะ'
    expect(await secureDraft(realState(), plain)).toEqual({ draft: plain, links: [], skipped: 'no-link' })
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('ลิงก์ปลอดภัยที่ยังเปิดได้ไม่ถูกเผยแพร่ซ้ำ แค่ตรวจว่ายังไม่ถูกปิด', async () => {
    const fetchMock = await login()
    const already = `ดูที่ https://x.test/#/document/${'A'.repeat(22)}.${'k'.repeat(43)}`
    fetchMock.mockResolvedValueOnce(json([{ token: 'A'.repeat(22), expires_at: LATER, revoked_at: null }]))
    const result = await secureDraft(realState(), already)
    expect(result.skipped).toBeNull()
    expect(result.draft).toBe(already)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('publish_shared_document'))).toHaveLength(0)
  })

  it('ร่างที่ถือลิงก์ซึ่งครูปิดไปแล้ว บอกว่า stale ให้ไปสร้างร่างใหม่ ไม่ใช่ส่งลิงก์ที่ตายแล้ว', async () => {
    const fetchMock = await login()
    const already = `ดูที่ https://x.test/#/document/${'A'.repeat(22)}.${'k'.repeat(43)}`
    fetchMock.mockResolvedValueOnce(json([{ token: 'A'.repeat(22), expires_at: LATER, revoked_at: '2025-09-01T00:00:00Z' }]))
    expect((await secureDraft(realState(), already)).skipped).toBe('stale')
    fetchMock.mockResolvedValueOnce(json([]))
    expect((await secureDraft(realState(), already)).skipped).toBe('stale')
  })

  it('ตรวจความมีชีวิตไม่สำเร็จ = ล้ม ไม่ใช่ถือว่ายังใช้ได้', async () => {
    const fetchMock = await login()
    const already = `ดูที่ https://x.test/#/document/${'A'.repeat(22)}.${'k'.repeat(43)}`
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    expect((await secureDraft(realState(), already)).skipped).toBe('failed')
  })
})

describe('การอ่านของผู้ปกครองและการเพิกถอนของครู', () => {
  it('อ่านด้วยกุญแจสาธารณะ ไม่มี Authorization และไม่มี token อยู่ใน URL', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json([{ kind: 'invoice', cipher: 'c', iv: 'i', expires_at: '2025-12-01T02:00:00Z' }]))
    const found = await resolveSharedDocument('Z'.repeat(22))
    expect(found).toEqual({ status: 'ok', row: { kind: 'invoice', cipher: 'c', iv: 'i', expiresAt: '2025-12-01T02:00:00Z' } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${projectUrl}/rest/v1/rpc/read_shared_document`)
    expect(String(url)).not.toContain('Z'.repeat(22))
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual({ p_token: 'Z'.repeat(22) })
  })

  it('หมดอายุ ถูกเพิกถอน หรือไม่มีอยู่ ได้ผลเดียวกัน — ไม่บอกคนนอกว่า token ไหนเคยมี', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(json([]))
    expect(await resolveSharedDocument('Z'.repeat(22))).toEqual({ status: 'gone' })
    fetchMock.mockResolvedValueOnce(json({ message: 'bad request' }, 400))
    expect(await resolveSharedDocument('Z'.repeat(22))).toEqual({ status: 'gone' })
    fetchMock.mockResolvedValueOnce(json([{ kind: 'invoice', cipher: 'c' }]))
    expect(await resolveSharedDocument('Z'.repeat(22))).toEqual({ status: 'gone' })
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    expect(await resolveSharedDocument('Z'.repeat(22))).toEqual({ status: 'offline' })
    fetchMock.mockResolvedValueOnce(json({}, 503))
    expect(await resolveSharedDocument('Z'.repeat(22))).toEqual({ status: 'offline' })
  })

  it('บิลด์ที่ยังไม่ได้ตั้งค่าโปรเจกต์ไม่ยิงคำขอออกไปเลย', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    expect(await resolveSharedDocument('Z'.repeat(22))).toEqual({ status: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('รายการของครูขอเฉพาะคอลัมน์ที่ต้องใช้ และทิ้งแถวที่รูปแบบไม่ครบ', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json([
      { token: 'A'.repeat(22), kind: 'invoice', label: 'l', label_iv: 'i', created_at: 'a', expires_at: 'b', revoked_at: null },
      { token: 'B'.repeat(22), kind: 'statement', label: null, label_iv: null, created_at: 'a', expires_at: 'b', revoked_at: null },
    ]))
    const rows = await listSharedDocuments()
    expect(rows.map(r => r.token)).toEqual(['A'.repeat(22)])
    const requested = String(fetchMock.mock.calls[1][0])
    expect(requested).toContain('/rest/v1/shared_documents?select=token,kind,label,label_iv,created_at,expires_at,revoked_at')
    expect(requested).not.toContain('cipher')
  })

  it('เพิกถอนคืน false เมื่อไม่มีอะไรเปลี่ยน ไม่ใช่รายงานว่าสำเร็จ', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(json(true))
    expect(await revokeSharedDocument('A'.repeat(22))).toBe(true)
    fetchMock.mockResolvedValueOnce(json(false))
    expect(await revokeSharedDocument('A'.repeat(22))).toBe(false)
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ p_token: 'A'.repeat(22) })
  })
})

describe('ลิงก์รุ่นเดิมที่ผู้ปกครองถืออยู่แล้ว', () => {
  it('ยังถอดได้เหมือนเดิม และยังเป็นลิงก์ที่กำหนดวันหมดอายุไม่ได้', () => {
    const { doc } = anInvoice()
    const legacy = documentUrl(doc).split('/document/')[1]
    expect(readDocument(legacy)).toEqual(doc)
    expect(parseDocumentRoute(legacy).legacy).toBe(legacy)
    expect(parseDocumentRoute(legacy).secure).toBeNull()
  })
})
