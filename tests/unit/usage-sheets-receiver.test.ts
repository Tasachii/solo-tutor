import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'docs/usage-sheets/Code.gs'), 'utf8')
const id = '3fef1b5f-0dfd-4beb-8f4c-c779c07a2670'

function receiver(options: { failFirstWrite?: boolean } = {}) {
  const cache = new Map<string, string>()
  const properties = new Map<string, string>([
    ['USAGE_WEBHOOK_SECRET', 'server-only-secret-at-least-24'],
    ['USAGE_SHEET_ID', 'sheet_id_12345678901234567890'],
  ])
  const rows: unknown[][] = []
  const openedIds: string[] = []
  let fail = !!options.failFirstWrite
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: (row: unknown[]) => { rows.push(row) },
    getRange: () => ({ setValues: (values: unknown[][]) => {
      if (fail) { fail = false; throw new Error('temporary Sheet failure') }
      rows.push(...values)
    } }),
  }
  const context = {
    Date, JSON, Number, Object, Array, String, RegExp, isNaN,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => { properties.set(key, value) },
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    CacheService: { getScriptCache: () => ({
      get: (key: string) => cache.get(key) ?? null,
      put: (key: string, value: string) => { cache.set(key, value) },
    }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getId: () => 'bound_sheet_12345678901234567890' }),
      openById: (sheetId: string) => {
        openedIds.push(sheetId)
        return { getSheetByName: () => sheet, insertSheet: () => sheet }
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm: string, value: string) => [...Buffer.from(value)],
      base64EncodeWebSafe: (bytes: number[]) => Buffer.from(bytes).toString('base64url'),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this } }),
    },
  }
  runInNewContext(source, context)
  const post = (payload: unknown) => JSON.parse((context as unknown as {
    doPost: (event: unknown) => { text: string }
  }).doPost({ postData: { contents: JSON.stringify(payload) } }).text) as { ok: boolean; error?: string; accepted: number }
  const setup = () => (context as unknown as { setupSheetId: () => string }).setupSheetId()
  return { post, setup, rows, cache, properties, openedIds }
}

const payload = (row: Record<string, unknown>) => ({
  format: 'solo-usage-1', secret: 'server-only-secret-at-least-24', rows: [row],
})
const validRow = { random_id: id, event: 'app_open', count: 1, at: '2026-09-08T08:00:00.000Z' }

describe('usage Google Sheets receiver', () => {
  it('writes only the four-column aggregate row and deduplicates a successful retry', () => {
    const app = receiver()
    expect(app.post(payload(validRow))).toEqual({ ok: true, accepted: 1 })
    expect(app.post(payload(validRow))).toEqual({ ok: true, accepted: 0 })
    expect(app.rows).toEqual([
      ['random_id', 'event', 'count', 'at'],
      [id, 'app_open', 1, '2026-09-08T08:00:00.000Z'],
    ])
    expect(app.openedIds).toEqual(['sheet_id_12345678901234567890', 'sheet_id_12345678901234567890'])
  })

  it('marks a row seen only after Sheet writing succeeds, so a transient failure can retry', () => {
    const app = receiver({ failFirstWrite: true })
    expect(app.post(payload(validRow))).toMatchObject({ ok: false, error: 'internal' })
    expect([...app.cache.keys()].some(key => key.startsWith('seen:'))).toBe(false)
    expect(app.post(payload(validRow))).toEqual({ ok: true, accepted: 1 })
    expect(app.rows).toHaveLength(2)
  })

  it('rejects coercible counts, prototype event names, invalid dates, and extra identifying fields', () => {
    const app = receiver()
    for (const row of [
      { ...validRow, count: '1' },
      { ...validRow, event: 'constructor' },
      { ...validRow, at: '2026-02-30T08:00:00.000Z' },
      { ...validRow, student_name: 'must never enter the Sheet' },
    ]) expect(app.post(payload(row))).toMatchObject({ ok: false, error: 'invalid' })
    expect(app.rows).toEqual([])
  })

  it('rejects the wrong shared secret', () => {
    const app = receiver()
    expect(app.post({ ...payload(validRow), secret: 'wrong-secret' })).toMatchObject({ ok: false, error: 'unauthorized' })
    expect(app.rows).toEqual([])
  })

  it('captures the bound spreadsheet ID during one-time editor setup', () => {
    const app = receiver()
    expect(app.setup()).toBe('bound_sheet_12345678901234567890')
    expect(app.properties.get('USAGE_SHEET_ID')).toBe('bound_sheet_12345678901234567890')
  })
})
