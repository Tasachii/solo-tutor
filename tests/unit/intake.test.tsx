import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { buildErrorReport, bundleVersion, reportError } from '../../src/core/errorReport'
import { waitlistEndpoint } from '../../src/platform/WaitlistSheet'

// ฟอร์มจองสิทธิ์อยู่ใต้ StoreProvider ในแอปจริง — ที่นี่ปลอม store ให้บันทึกสำเร็จเสมอ
vi.mock('../../src/core/store', () => ({
  useStore: () => ({ state: { mode: 'demo', waitlist: [] }, dispatch: () => true, track: () => {} }),
}))

const projectUrl = 'https://project-ref.supabase.co'
const configure = () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

/** แอปพังที่เครื่องครูแล้วเราต้องรู้ — แต่สิ่งที่ส่งออกต้องไม่มีข้อมูลนักเรียนเลย */
describe('รายงาน error', () => {
  it('ส่งไปที่ report-error ของโปรเจกต์เดียวกัน พร้อมแค่สิ่งที่ช่วยแก้บั๊ก', () => {
    configure()
    const send = vi.fn().mockResolvedValue(new Response('{}'))
    const err = new TypeError('boom')
    err.stack = 'TypeError: boom\n at https://qa.example/solo-tutor/assets/index-Abc.js:12:34'
    const report = buildErrorReport(err, { route: '#/app/billing', mode: 'real', userAgent: 'ua', appVersion: 'abc' })
    expect(reportError(report, send as unknown as typeof fetch)).toBe(true)
    const [url, init] = send.mock.calls[0]
    expect(url).toBe(`${projectUrl}/functions/v1/report-error`)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(Object.keys(body).sort()).toEqual(['appVersion', 'message', 'mode', 'route', 'stack', 'userAgent'])
    expect(body.message).toBe('TypeError: application failure')
    expect(body.stack).toBe('assets/index-Abc.js:12:34')
    expect(JSON.stringify(body)).not.toContain('boom')
  })

  it('ไม่มีโปรเจกต์ = ไม่ส่งอะไรออกไปเลย', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const send = vi.fn()
    expect(reportError(buildErrorReport(new Error('x')), send as unknown as typeof fetch)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('ตัดความยาวทุกช่อง และอ่านเวอร์ชันจาก hash ของบันเดิล', () => {
    const long = new Error('m'.repeat(600)); long.stack = ' at https://qa.example/assets/index-Abc.js:12:34\n'.repeat(500)
    const r = buildErrorReport(long, { route: 'r'.repeat(300) })
    expect(r.message).toBe('Error: application failure')
    expect(r.stack!.length).toBe(4000)
    expect(r.route).toBe('#/unknown')
    const doc = document.implementation.createHTMLDocument('')
    doc.body.innerHTML = '<script src="/solo-tutor/assets/index-Ab9_x1.js"></script>'
    expect(bundleVersion(doc)).toBe('Ab9_x1')
    expect(bundleVersion(document.implementation.createHTMLDocument(''))).toBeUndefined()
  })

  it('ErrorBoundary เรียกส่งเมื่อลูกโยน error', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: ErrorBoundary } = await import('../../src/app/ErrorBoundary')
    const Boom = () => { throw new Error('render exploded') }
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/functions/v1/report-error')
    expect(JSON.parse((init as RequestInit).body as string).message).toBe('Error: application failure')
    expect(screen.getByText('หน้านี้มีปัญหา')).toBeTruthy()
  })
})

/** จองสิทธิ์รุ่นแรกต้องถึงเราจริง ไม่ใช่ค้างในเครื่องคนกรอก */
describe('ปลายทางฟอร์มจองสิทธิ์', () => {
  it('ชี้ไปที่ Edge Function ของโปรเจกต์เดียวกับบัญชีครู', () => {
    configure()
    expect(waitlistEndpoint()).toBe(`${projectUrl}/functions/v1/waitlist`)
  })
  it('ไม่มีโปรเจกต์ = ว่าง แล้วฟอร์มจะบอกว่าเก็บในเครื่อง', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    expect(waitlistEndpoint()).toBe('')
  })
  it('ส่ง JSON ที่มีเฉพาะช่องในฟอร์ม', async () => {
    configure()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    const { default: WaitlistSheet } = await import('../../src/platform/WaitlistSheet')
    render(<WaitlistSheet preselect="tutor" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('ชื่อ'), { target: { value: 'ครูมายด์' } })
    fireEvent.change(screen.getByLabelText('LINE ID หรือเบอร์'), { target: { value: '@mind' } })
    fireEvent.click(screen.getByRole('button', { name: 'ส่งข้อมูล' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${projectUrl}/functions/v1/waitlist`)
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ professionId: 'tutor', name: 'ครูมายด์', contact: '@mind' })
    // JSON ทิ้งค่า undefined (ขนาด/วิธีเก็บเงินที่ไม่ได้เลือก) — แต่ห้ามมีอะไรนอกจากช่องในฟอร์ม
    const allowed = ['concierge', 'contact', 'modes', 'name', 'professionId', 'size']
    expect(Object.keys(body).every((k) => allowed.includes(k))).toBe(true)
    expect(body).not.toHaveProperty('subjects')
    await screen.findByText('ส่งข้อมูลให้ทีมแล้ว')
  })
})
