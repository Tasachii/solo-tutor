import { afterEach, describe, expect, it, vi } from 'vitest'
import { signIn, signOut } from '../../src/integrations/supabaseRest'
import { readSnapshot, saveSnapshot } from '../../src/integrations/cloudApi'

const projectUrl = 'https://project-ref.supabase.co'
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authBody = { access_token: 'access-one', refresh_token: 'refresh-one', expires_in: 3600, user: { id: 'user-1', email: 't@example.com' } }

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); signOut(); vi.unstubAllEnvs() })

const login = async () => {
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_browser_test')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(authBody))
  await signIn('t@example.com', 'password')
  return fetchMock
}

describe('cloudApi', () => {
  it('readSnapshot: ไม่มีแถว → null · มีแถว → map ครบและไม่เชื่อแถวที่ขาด', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    expect(await readSnapshot()).toBeNull()
    fetchMock.mockResolvedValueOnce(jsonResponse([{ revision: 3, schema_version: 5, cipher: 'c', iv: 'i', updated_at: '2025-09-02T00:00:00Z', device: 'Mac' }]))
    expect(await readSnapshot()).toEqual({ revision: 3, schema_version: 5, cipher: 'c', iv: 'i', updated_at: '2025-09-02T00:00:00Z', device: 'Mac' })
    fetchMock.mockResolvedValueOnce(jsonResponse([{ revision: '3', cipher: 'c' }]))
    expect(await readSnapshot()).toBeNull()
    expect(String(fetchMock.mock.calls[1][0])).toContain('/rest/v1/ledger_snapshots?select=')
  })

  it('saveSnapshot ส่ง expected/revision ให้ฟังก์ชันตรวจ และแปล ok=false เป็นชน ไม่ใช่ throw', async () => {
    const fetchMock = await login()
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ok: true, revision: 4, updated_at: 'x' }]))
    const saved = await saveSnapshot({ expected: 3, revision: 4, schema: 5, cipher: 'c', iv: 'i', device: 'd'.repeat(120) })
    expect(saved).toEqual({ ok: true, revision: 4 })
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toContain('/rest/v1/rpc/save_ledger_snapshot')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ p_expected_revision: 3, p_revision: 4, p_schema_version: 5, p_cipher: 'c', p_iv: 'i', p_kdf: 'pbkdf2-sha256-310000' })
    expect(body.p_device).toHaveLength(80)

    fetchMock.mockResolvedValueOnce(jsonResponse([{ ok: false, revision: 9, updated_at: null }]))
    expect(await saveSnapshot({ expected: 3, revision: 4, schema: 5, cipher: 'c', iv: 'i', device: 'd' })).toEqual({ ok: false, revision: 9 })
  })
})
