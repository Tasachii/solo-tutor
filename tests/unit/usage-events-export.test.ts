import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/usage-events-json-to-csv.mjs')
const row = {
  random_id: '3fef1b5f-0dfd-4beb-8f4c-c779c07a2670',
  event: 'app_open', count: 1, at: '2026-09-07 23:33:42.026261+00',
}

describe('linked Supabase usage CSV parser', () => {
  it('writes only the four whitelisted aggregate columns', () => {
    const result = spawnSync(process.execPath, [script], { input: JSON.stringify({ boundary: 'ignored', rows: [row] }), encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('random_id,event,count,at\n"3fef1b5f-0dfd-4beb-8f4c-c779c07a2670","app_open","1","2026-09-07 23:33:42.026261+00"\n')
    expect(result.stderr).toBe('')
  })

  it('fails closed before emitting CSV when setup text or extra identifying fields appear', () => {
    const prefixed = spawnSync(process.execPath, [script], { input: `Initialising login role...\n${JSON.stringify({ rows: [row] })}`, encoding: 'utf8' })
    expect(prefixed.status).not.toBe(0)
    expect(prefixed.stdout).toBe('')
    const extra = spawnSync(process.execPath, [script], { input: JSON.stringify({ rows: [{ ...row, provider_id: 'must-not-export' }] }), encoding: 'utf8' })
    expect(extra.status).not.toBe(0)
    expect(extra.stdout).toBe('')
  })
})
