import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SharedDocument from '../../src/app/SharedDocument'
import { buildScenario } from '../../src/core/scenarios'
import { documentUrl, invoiceDocument } from '../../src/core/documents'
import { exportUrlKey, generateDocumentKey, sealDocument } from '../../src/core/documentShare'
import { copy } from '../../src/copy'

const projectUrl = 'https://project-ref.supabase.co'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
}

const theInvoice = () => {
  const state = buildScenario('default')
  return invoiceDocument(state, state.invoices[0].id)!
}

const show = (token: string) => render(
  <MemoryRouter initialEntries={[`/document/${token}`]}>
    <Routes><Route path="/document/:token" element={<SharedDocument />} /></Routes>
  </MemoryRouter>,
)

const sealedFor = async () => {
  const doc = theInvoice()
  const key = await generateDocumentKey()
  const sealed = await sealDocument(key, doc)
  return { doc, sealed, urlKey: await exportUrlKey(key) }
}

describe('หน้าเอกสารที่ผู้ปกครองเปิด', () => {
  it('ลิงก์รุ่นเดิมยังเปิดได้ และบอกตรง ๆ ว่าปิดหรือกำหนดวันหมดอายุไม่ได้', async () => {
    const doc = theInvoice()
    show(documentUrl(doc).split('/document/')[1])
    expect(await screen.findByRole('heading', { name: 'ใบแจ้งยอด' })).toBeTruthy()
    expect(screen.getByText(doc.payer, { exact: false })).toBeTruthy()
    expect(screen.getByText(copy.sharedDoc.legacyNote)).toBeTruthy()
  })

  it('ลิงก์ปลอดภัยถอดรหัสในเครื่องผู้รับ แสดงวันหมดอายุ และไม่ส่งกุญแจออกไป', async () => {
    configure()
    const { doc, sealed, urlKey } = await sealedFor()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json([{ kind: 'invoice', cipher: sealed.cipher, iv: sealed.iv, expires_at: '2025-12-01T05:00:00Z' }]))
    show(`${'T'.repeat(22)}.${urlKey}`)

    expect(await screen.findByRole('heading', { name: 'ใบแจ้งยอด' })).toBeTruthy()
    expect(screen.getByText(doc.payer, { exact: false })).toBeTruthy()
    // 1 ธ.ค. 2568 ตามเวลาไทย — ผู้รับต้องเห็นวันที่ลิงก์ปิดตัวเอง
    expect(screen.getByText(/ลิงก์นี้เปิดได้ถึง.*1 ธันวาคม 2568/)).toBeTruthy()
    expect(screen.getByText(new RegExp(copy.sharedDoc.revocableNote.slice(0, 20)))).toBeTruthy()

    const [url, init] = fetchMock.mock.calls[0]
    expect(`${String(url)} ${String(init?.body ?? '')}`).not.toContain(urlKey)
  })

  it('ลิงก์ที่ถูกเพิกถอนหรือหมดอายุแล้วได้ข้อความเดียวกัน ไม่มีเนื้อเอกสารหลุดออกมา', async () => {
    configure()
    const { urlKey } = await sealedFor()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]))
    show(`${'T'.repeat(22)}.${urlKey}`)
    expect(await screen.findByRole('heading', { name: copy.sharedDoc.cannotOpen })).toBeTruthy()
    expect(screen.getByText(copy.sharedDoc.gone)).toBeTruthy()
    expect(document.querySelector('.paper')).toBeNull()
  })

  it('ciphertext ที่ถูกแก้ กุญแจผิด และ token ที่รูปแบบไม่ครบ ล้มแบบปิดทั้งหมด', async () => {
    configure()
    const { sealed, urlKey } = await sealedFor()
    const broken = sealed.cipher.slice(0, -4) + (sealed.cipher.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json([{ kind: 'invoice', cipher: broken, iv: sealed.iv, expires_at: '2025-12-01T05:00:00Z' }]))
    show(`${'T'.repeat(22)}.${urlKey}`)
    expect(await screen.findByText(copy.sharedDoc.tampered)).toBeTruthy()
    cleanup()

    show(`${'T'.repeat(22)}.${'k'.repeat(10)}`)
    expect(await screen.findByText(copy.sharedDoc.tampered)).toBeTruthy()
    cleanup()

    show('not-a-real-document')
    expect(await screen.findByText(copy.sharedDoc.tampered)).toBeTruthy()
  })

  it('เครือข่ายล่มบอกให้ลองใหม่ และปุ่มลองใหม่ยิงคำขออีกครั้งจริง', async () => {
    configure()
    const { sealed, urlKey } = await sealedFor()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline'))
    show(`${'T'.repeat(22)}.${urlKey}`)
    const retry = await screen.findByRole('button', { name: copy.sharedDoc.retry })
    fetchMock.mockResolvedValueOnce(
      json([{ kind: 'invoice', cipher: sealed.cipher, iv: sealed.iv, expires_at: '2025-12-01T05:00:00Z' }]))
    retry.click()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ใบแจ้งยอด' })).toBeTruthy())
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  it('บิลด์ที่ไม่ได้ตั้งค่าโปรเจกต์บอกให้ขอลิงก์ใหม่ แทนที่จะขึ้นจอขาว', async () => {
    const { urlKey } = await sealedFor()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    show(`${'T'.repeat(22)}.${urlKey}`)
    expect(await screen.findByText(copy.sharedDoc.unavailable)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
