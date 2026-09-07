import { request, rpc } from './supabaseRest'
import type { CloudSnapshot } from '../core/cloudSync'
import { KDF_ID } from '../core/cloudCrypto'

/** แถวเดียวต่อครู — RLS กรองให้เห็นแต่ของตัวเอง จึงไม่ต้องส่ง provider_id */
export async function readSnapshot(): Promise<CloudSnapshot | null> {
  const rows = await request<Partial<CloudSnapshot>[]>(
    '/rest/v1/ledger_snapshots?select=revision,schema_version,cipher,iv,updated_at,device&limit=1',
  )
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row || typeof row.revision !== 'number' || typeof row.cipher !== 'string' || typeof row.iv !== 'string'
    || typeof row.schema_version !== 'number' || typeof row.updated_at !== 'string') return null
  return {
    revision: row.revision, schema_version: row.schema_version, cipher: row.cipher, iv: row.iv,
    updated_at: row.updated_at, device: typeof row.device === 'string' ? row.device : null,
  }
}

export type SaveResult = { ok: true; revision: number } | { ok: false; revision: number }

/** ok=false = มีคนเขียนก่อน (revision บนคลาวด์ไม่ตรงที่เราเห็น) — ไม่ใช่ความผิดพลาดของเครือข่าย */
export async function saveSnapshot(input: {
  expected: number; revision: number; schema: number; cipher: string; iv: string; device: string
}): Promise<SaveResult> {
  const rows = await rpc<{ ok: boolean; revision: number }[]>('save_ledger_snapshot', {
    p_expected_revision: input.expected, p_revision: input.revision, p_schema_version: input.schema,
    p_cipher: input.cipher, p_iv: input.iv, p_kdf: KDF_ID, p_device: input.device.slice(0, 80),
  })
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row || typeof row.ok !== 'boolean' || typeof row.revision !== 'number') throw new Error('save_ledger_snapshot: bad response')
  return row.ok ? { ok: true, revision: row.revision } : { ok: false, revision: row.revision }
}

export const deleteSnapshot = (): Promise<boolean> => rpc<boolean>('delete_ledger_snapshot', {})
