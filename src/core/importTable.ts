/**
 * นำเข้ารายชื่อนักเรียนจากไฟล์ที่ติวเตอร์มีอยู่แล้ว — CSV · TSV · XLSX
 * ตรรกะล้วน ไม่แตะ DOM ไม่เรียกเน็ต
 *
 * อ่าน .xlsx เองแทนใช้ไลบรารี: ไฟล์เป็นแค่ zip ที่ข้างในเป็น XML และเบราว์เซอร์สมัยนี้
 * มี DecompressionStream ให้อยู่แล้ว — ตัวอ่าน xlsx สำเร็จรูปตัวหลักบน npm ค้างอยู่ที่เวอร์ชัน
 * ที่มีช่องโหว่ prototype pollution ซึ่งไม่ควรเอามาแตะไฟล์ที่ผู้ใช้เลือกมาเอง
 */

export type Grid = string[][]

// ── CSV / TSV ───────────────────────────────────────

/** เดาตัวคั่นจากบรรทัดแรก — Google Sheets ที่ copy มาให้ tab, ไฟล์ที่ export ให้ comma */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
  const counts: [string, number][] = [
    ['\t', (line.match(/\t/g) ?? []).length],
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/** อ่าน CSV ตามกติกาจริง: ฟิลด์ในเครื่องหมายคำพูดมีตัวคั่นและขึ้นบรรทัดใหม่ข้างในได้ */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): Grid {
  const src = text.replace(/^﻿/, '')
  const grid: Grid = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delimiter) { row.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(cell); grid.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  row.push(cell)
  grid.push(row)
  return grid.filter((r) => r.some((c) => c.trim() !== ''))
}

// ── XLSX ────────────────────────────────────────────

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** คลายบีบอัดด้วยของที่เบราว์เซอร์มีให้อยู่แล้ว — ไม่ผ่าน Blob เพราะไม่ใช่ทุกที่ที่มี .stream() */
async function inflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) { controller.enqueue(bytes); controller.close() },
  })
  const reader = (source.pipeThrough(new DecompressionStream('deflate-raw')) as ReadableStream<Uint8Array>).getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); total += value.length
  }
  const merged = new Uint8Array(total)
  let at = 0
  for (const part of parts) { merged.set(part, at); at += part.length }
  return merged
}

/**
 * อ่านไฟล์ในกล่อง zip เท่าที่ต้องใช้ — ไม่ใช่ตัวแตก zip ครบสูตร
 * รองรับ stored (0) และ deflate (8) ซึ่งเป็นสองแบบที่ Excel และ Google Sheets ใช้
 */
export async function readZipEntries(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const b = new Uint8Array(buf)
  const view = dv(b)
  let eocd = -1
  for (let i = b.length - 22; i >= 0 && i > b.length - 22 - 65_536; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not-a-zip')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out = new Map<string, string>()
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!wanted(name)) continue
    const lv = dv(b)
    const lNameLen = lv.getUint16(localOffset + 26, true)
    const lExtraLen = lv.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const raw = b.subarray(start, start + compressedSize)
    out.set(name, dec.decode(method === 0 ? raw : await inflateRaw(new Uint8Array(raw))))
  }
  return out
}

const unescapeXml = (s: string): string => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&')

/** "A" → 0 · "Z" → 25 · "AA" → 26 — คอลัมน์ที่ว่างกลางตารางจะได้ไม่เลื่อน */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''))
}

export function parseSheetXml(xml: string, shared: string[]): Grid {
  const grid: Grid = []
  for (const rowM of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    for (const cellM of rowM[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellM[1]
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? ''
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
      const body = cellM[2]
      let value = ''
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1')
        value = shared[idx] ?? ''
      } else if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('')
      } else {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')
      }
      const at = ref ? columnIndex(ref) : row.length
      while (row.length < at) row.push('')
      row[at] = value
    }
    grid.push(row)
  }
  return grid.filter((r) => r.some((c) => c.trim() !== ''))
}

export async function parseXlsx(buf: ArrayBuffer): Promise<Grid> {
  const files = await readZipEntries(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet1\.xml$/.test(n))
  const sheet = files.get('xl/worksheets/sheet1.xml')
  if (!sheet) throw new Error('no-sheet')
  return parseSheetXml(sheet, parseSharedStrings(files.get('xl/sharedStrings.xml') ?? ''))
}

// ── จับคอลัมน์เข้ากับช่องของเรา ─────────────────────

export type Field = 'name' | 'payer' | 'line' | 'price'
export interface Mapping { header: boolean; name: number; payer: number; line: number; price: number }

const HINTS: Record<Field, string[]> = {
  name: ['ชื่อ', 'นักเรียน', 'ลูกค้า', 'name', 'student', 'client', 'customer'],
  payer: ['ผู้ปกครอง', 'ผู้จ่าย', 'ผู้ติดต่อ', 'payer', 'parent', 'guardian', 'contact'],
  line: ['line', 'ไลน์', 'ไอดี', 'id'],
  price: ['ราคา', 'ค่าเรียน', 'ค่าบริการ', 'ยอด', 'price', 'rate', 'amount', 'fee'],
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

/**
 * เดาว่าคอลัมน์ไหนคืออะไรจากหัวตาราง — เดาผิดได้ ผู้ใช้แก้ได้ในหน้าจอ
 * ไม่มีหัวตาราง = ถือว่าคอลัมน์แรกคือชื่อ ถัดไปคือผู้จ่าย ตามลำดับที่คนส่วนใหญ่เรียง
 */
export function detectMapping(grid: Grid): Mapping {
  const first = grid[0] ?? []
  // แถวแรกเป็นหัวตารางเมื่อช่องแรกคือคำว่า "ชื่อ/นักเรียน" หรือมีอย่างน้อย 2 ช่องที่เป็นคำหัวตาราง
  // — เคยกินนักเรียนคนแรกทิ้งเพราะผู้จ่ายชื่อ "ผู้ปกครอง1" ไปตรงกับคำใบ้ช่องผู้จ่าย
  const hintCells = first.filter((c) => Object.values(HINTS).flat().some((h) => norm(c).includes(norm(h)))).length
  const firstIsNameHint = HINTS.name.some((h) => norm(first[0] ?? '').includes(norm(h)))
  const looksLikeHeader = firstIsNameHint || hintCells >= 2
  if (!looksLikeHeader) return { header: false, name: 0, payer: first.length > 1 ? 1 : -1, line: first.length > 2 ? 2 : -1, price: -1 }
  const find = (f: Field): number =>
    first.findIndex((c) => HINTS[f].some((h) => norm(c).includes(norm(h))))
  const name = find('name')
  return { header: true, name: name < 0 ? 0 : name, payer: find('payer'), line: find('line'), price: find('price') }
}

export interface ImportRow { name: string; clientName: string; lineId?: string; price?: number; error?: string }

const cell = (row: string[], at: number): string => (at >= 0 ? (row[at] ?? '').trim() : '')

/** ราคาในไฟล์จริงมักมี "บาท" หรือ comma ปน — เอาเฉพาะตัวเลขและต้องเป็นจำนวนเต็มบวก */
export function parsePrice(raw: string): number | undefined {
  if (!raw) return undefined
  const cleaned = raw.trim().replace(/[฿,\s]|บาท/g, '')
  if (!/^\d+$/.test(cleaned)) return undefined
  const digits = cleaned
  if (!digits) return undefined
  const n = Number(digits)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/** ชื่อเทียบกันแบบไม่สนช่องว่างซ้อนและตัวพิมพ์ — "น้องปลา " กับ "น้องปลา" คือคนเดียวกัน */
export const nameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

export interface DedupeResult {
  /** แถวที่จะสร้างจริง — ชื่อแรกที่เจอในลิสต์เท่านั้น และไม่ซ้ำกับที่มีอยู่ */
  rows: ImportRow[]
  /** จำนวนที่ตัดเพราะซ้ำกันเองในลิสต์ */
  duplicatesInList: number
  /** ชื่อที่ซ้ำกับรายชื่อที่มีอยู่แล้ว (ข้ามให้ ไม่สร้างคนเดิมซ้ำ) */
  existing: string[]
}

/** วาง 25 ชื่อจาก LINE มักมีซ้ำและมีคนที่เพิ่มไปแล้ว — ตัดให้ก่อน แล้วบอกว่าตัดอะไรไป */
export function dedupeRows(rows: ImportRow[], existingNames: Iterable<string>): DedupeResult {
  const taken = new Set(Array.from(existingNames, nameKey))
  const seen = new Set<string>()
  const out: ImportRow[] = []
  const existing: string[] = []
  let duplicatesInList = 0
  for (const row of rows) {
    if (row.error) { out.push(row); continue }
    const key = nameKey(row.name)
    if (seen.has(key)) { duplicatesInList += 1; continue }
    seen.add(key)
    if (taken.has(key)) { existing.push(row.name.trim()); continue }
    out.push({ ...row, name: row.name.trim(), clientName: row.clientName.trim() })
  }
  return { rows: out, duplicatesInList, existing }
}

export function toRows(grid: Grid, map: Mapping): ImportRow[] {
  return grid.slice(map.header ? 1 : 0).map((r) => {
    const name = cell(r, map.name)
    const clientName = cell(r, map.payer) || name
    if (!name) return { name: r.join(' ').trim() || '—', clientName: '', error: 'ไม่มีชื่อ' }
    return { name, clientName, lineId: cell(r, map.line) || undefined, price: parsePrice(cell(r, map.price)) }
  })
}
