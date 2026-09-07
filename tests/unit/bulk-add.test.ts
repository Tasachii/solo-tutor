import { describe, expect, it } from 'vitest'
import { dedupeRows, nameKey, parseDelimited, detectMapping, toRows } from '../../src/core/importTable'

/** วาง 25 ชื่อจาก LINE — ต้องได้คนจริง ไม่ซ้ำ ไม่มีคนที่เพิ่มไปแล้ว */
describe('เพิ่มหลายคน — ตัดซ้ำ', () => {
  const rows = (names: string[]) => names.map((name) => ({ name, clientName: `ผู้ปกครอง${name.trim()}` }))

  it('ชื่อซ้ำกันเองในลิสต์เก็บแค่คนแรก และนับที่ตัดออก', () => {
    const r = dedupeRows(rows(['น้องปลา', 'น้องข้าว', 'น้องปลา ', ' น้องปลา', 'น้องข้าว']), [])
    expect(r.rows.map((x) => x.name)).toEqual(['น้องปลา', 'น้องข้าว'])
    expect(r.duplicatesInList).toBe(3)
    expect(r.existing).toEqual([])
  })

  it('ชื่อที่มีอยู่แล้วถูกข้าม และบอกชื่อให้ครูเห็น', () => {
    const r = dedupeRows(rows(['น้องปลา', 'น้องใหม่']), ['น้องปลา', 'น้องเก่า'])
    expect(r.rows.map((x) => x.name)).toEqual(['น้องใหม่'])
    expect(r.existing).toEqual(['น้องปลา'])
  })

  it('เทียบชื่อไม่สนช่องว่างซ้อนและตัวพิมพ์', () => {
    expect(nameKey('  Nong  Pla ')).toBe(nameKey('nong pla'))
    expect(dedupeRows(rows(['Nong Pla']), ['nong  pla']).existing).toEqual(['Nong Pla'])
  })

  it('แถวที่พังอยู่แล้ว (ไม่มีชื่อ) ผ่านไปให้ครูเห็นตามเดิม ไม่ถูกนับเป็นซ้ำ', () => {
    const r = dedupeRows([{ name: '—', clientName: '', error: 'ไม่มีชื่อ' }, ...rows(['น้องปลา'])], [])
    expect(r.rows).toHaveLength(2)
    expect(r.duplicatesInList).toBe(0)
  })

  it('ของจริง: วาง 25 บรรทัด มีบรรทัดว่างและซ้ำ → ได้ 20 คนภายในรอบเดียว', () => {
    const names = Array.from({ length: 20 }, (_, i) => `น้องคนที่${i + 1}`)
    const text = [...names, '', '  ', 'น้องคนที่3', 'น้องคนที่7 ', ' น้องคนที่20'].join('\n')
    const grid = parseDelimited(text)
    const parsed = toRows(grid, detectMapping(grid))
    const r = dedupeRows(parsed, [])
    expect(r.rows.filter((x) => !x.error)).toHaveLength(20)
    expect(r.duplicatesInList).toBe(3)
  })
})

/** หัวตารางต้องเดาจากคำหัวตารางจริง ไม่ใช่ชื่อคนที่บังเอิญมีคำว่า "ผู้ปกครอง" */
describe('เดาหัวตาราง', () => {
  it('แถวแรกที่เป็นชื่อคน + ผู้จ่ายชื่อ "ผู้ปกครอง1" ไม่ใช่หัวตาราง', () => {
    const grid = parseDelimited('น้องใหม่1, ผู้ปกครอง1\nน้องใหม่2, ผู้ปกครอง2')
    expect(detectMapping(grid).header).toBe(false)
    expect(toRows(grid, detectMapping(grid))).toHaveLength(2)
  })
  it('"ชื่อ, ผู้จ่าย" คือหัวตาราง', () => {
    expect(detectMapping(parseDelimited('ชื่อ, ผู้จ่าย\nน้องปลา, คุณแม่ปลา')).header).toBe(true)
  })
  it('"นักเรียน" ช่องแรกช่องเดียวก็นับเป็นหัวตาราง', () => {
    expect(detectMapping(parseDelimited('นักเรียน\nน้องปลา')).header).toBe(true)
  })
})
