import { describe, expect, it } from 'vitest'
import {
  columnIndex, detectDelimiter, detectMapping, parseDelimited, parsePrice,
  parseSharedStrings, parseSheetXml, parseXlsx, toRows,
} from '../../src/core/importTable'
import { rosterCsv } from '../../src/core/export'
import { buildScenario } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'

describe('อ่านไฟล์ที่คั่นด้วยตัวอักษร', () => {
  it('เดาตัวคั่นได้ — วางจาก Google Sheets มาเป็น tab ไฟล์ export มาเป็น comma', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a,b,c')).toBe(',')
    expect(detectDelimiter('a;b;c')).toBe(';')
    expect(detectDelimiter('เฉยๆ')).toBe(',')
  })

  it('ฟิลด์ในเครื่องหมายคำพูดมีตัวคั่นและขึ้นบรรทัดข้างในได้', () => {
    const grid = parseDelimited('ชื่อ,ผู้จ่าย\n"ปลา, น้อง","คุณแม่ ""ปลา"""\n"สอง\nบรรทัด",x')
    expect(grid).toEqual([
      ['ชื่อ', 'ผู้จ่าย'],
      ['ปลา, น้อง', 'คุณแม่ "ปลา"'],
      ['สอง\nบรรทัด', 'x'],
    ])
  })

  it('ตัด BOM และบรรทัดว่างทิ้ง', () => {
    expect(parseDelimited('﻿a,b\n\n\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })
})

describe('อ่าน .xlsx จริงโดยไม่พึ่งไลบรารี', () => {
  // ไฟล์ .xlsx จริงที่บีบอัดด้วย deflate ฝังไว้เป็น base64 — เทสตัวแตก zip ด้วย
  // และไม่ต้องอ่านไฟล์จากดิสก์ ซึ่งทำให้เทสต้องพึ่ง type ของ Node
  const XLSX_B64 = 'UEsDBBQAAAAIACZnJl0G8pnQggAAAKEAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbCWOSQ7CMAxFrxJlTx1YsEBJuqDcgAtY' +
    'kTuITEoMKrcnoUv7/e9nPe7Biw+VuqVo5HlQcrT6+c1URSOxGrky5xtAdSsFrEPKFBuZUwnIbSwLZHQvXAguSl3BpcgU+cT9' +
    'hrR6ohnfnsVjb+vD0upS3I9cVxmJOfvNITcMnYLV8H/C/gBQSwMEFAAAAAgAJmcmXYTk4jIFAQAA6QEAABQAAAB4bC9zaGFy' +
    'ZWRTdHJpbmdzLnhtbH2Rz0rEMBDGXyXkATbVw4KSdg/qYUF8BQlrtIUmqU0qHhUW/HOVPYgiqHj0sII4fZt5FJNILttdb5mZ' +
    'b77fx4RPLlVNLmRrK6NzujXK6KTg1jri+9rmtHSu2WXMzkqphB2ZRmo/OTWtEs6X7RmzTSvFiS2ldKpm21k2ZkpUmpKZ6bTL' +
    '6Q4lna7OO7mXag+oCu4KhHuEH+xvET4RHhGWCNfYXyG8I3wjvPkmZ67gLOjTzjNCj/0dwlNQwzyq/f7NqvRwenRApvtDh3lE' +
    'fq2QEBYpyp/nMlIGtkEaBgEZQ3x4r3UQAIQH7H3G12i8QdrU4lgZ9T9mEd9rrpEw8JLCD6TMf2fxC1BLAwQUAAAACAAmZyZd' +
    'XwlD6i0BAAC6AgAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbHWSsU6EMByHX6VhcLxywJ1GSy8qb+ATNFiFSIG0Dedq' +
    'YqLOTroZBwfjYOJQ3qaPcgW09pq7rf1/5ff9SopWt6wCHeWibOo0mM/CYIXRuuE3oqBUAkNrkQaFlO0xhCIvKCNi1rS0NuSq' +
    '4YxIs+XXULScksvxI1bBKAyXkJGyDjAaZxmRBCPerAE3FjPNh8XpPAAyDYTZdzhEsMMI5r/szGXzbXbusmibZS6LLYPGbQtE' +
    'tkDkHE68Ai5beAVctvQKRFNaGO6Wx1YeOyGHntxlR54gnirtEyRWkIwhZV2VNb2Q3MxLgZHEWr3o/kmrL60etPrU6k2rH60+' +
    'EJQmazjzX2R/xr1WSqtn3d8NAf2jmwQOCGtPwHjofRS9/q2/d4uyZPptC/9W0HlA0L5MvAFQSwECFAMUAAAACAAmZyZdBvKZ' +
    '0IIAAAChAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIACZnJl2E5OIyBQEAAOkB' +
    'AAAUAAAAAAAAAAAAAACAAbMAAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAIACZnJl1fCUPqLQEAALoCAAAYAAAA' +
    'AAAAAAAAAACAAeoBAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAMAAwDJAAAATQMAAAAA'
  const buf = () => {
    const bin = atob(XLSX_B64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }

  it('ได้ตารางครบ ทั้งข้อความร่วม ตัวเลข และ inline string ภาษาไทย', async () => {
    const grid = await parseXlsx(buf())
    expect(grid[0]).toEqual(['ชื่อนักเรียน', 'ผู้ปกครอง', 'LINE ID', 'ค่าเรียนต่อครั้ง'])
    expect(grid[1]).toEqual(['น้องปลา', 'คุณแม่ปลา', 'pla_mom', '400'])
    // แถวที่ไม่มีคอลัมน์ C ต้องเว้นช่องไว้ ไม่ใช่เลื่อนราคามาอยู่ช่อง LINE
    expect(grid[2]).toEqual(['น้องต้น', 'คุณพ่อต้น', '', '500'])
    // inline string และ entity ต้องถอดถูก
    expect(grid[3]).toEqual(['น้องหมิว', 'คุณแม่หมิว & ครอบครัว', '', '450'])
  })

  it('ไฟล์ที่ไม่ใช่ zip ต้องบอกว่าอ่านไม่ได้ ไม่ใช่เงียบ', async () => {
    await expect(parseXlsx(new TextEncoder().encode('ไม่ใช่ไฟล์ excel').buffer as ArrayBuffer)).rejects.toThrow()
  })

  it('อ้างอิงคอลัมน์แปลงเป็นดัชนีถูก', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AA1')).toBe(26)
    expect(columnIndex('AB12')).toBe(27)
  })

  it('ข้อความร่วมที่ถูกตัดเป็นหลายชิ้นต้องต่อกลับเป็นก้อนเดียว', () => {
    expect(parseSharedStrings('<si><r><t>คุณ</t></r><r><t>แม่</t></r></si><si><t>ปลา</t></si>'))
      .toEqual(['คุณแม่', 'ปลา'])
  })

  it('เซลล์ว่างท้ายแถวไม่ทำให้แถวหาย', () => {
    expect(parseSheetXml('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', ['x'])).toEqual([['x']])
  })
})

describe('จับคอลัมน์เข้ากับช่องของเรา', () => {
  it('มีหัวตาราง — จับตามชื่อ ไม่ใช่ตามลำดับ', () => {
    const grid = [['ราคา', 'LINE', 'ชื่อนักเรียน', 'ผู้ปกครอง'], ['400', 'x', 'น้องปลา', 'คุณแม่ปลา']]
    const m = detectMapping(grid)
    expect(m).toEqual({ header: true, name: 2, payer: 3, line: 1, price: 0 })
    expect(toRows(grid, m)).toEqual([{ name: 'น้องปลา', clientName: 'คุณแม่ปลา', lineId: 'x', price: 400 }])
  })

  it('ไม่มีหัวตาราง — ใช้ลำดับ และไม่กินแถวแรกทิ้ง', () => {
    const grid = [['น้องปลา', 'คุณแม่ปลา'], ['น้องต้น', 'คุณพ่อต้น']]
    const m = detectMapping(grid)
    expect(m.header).toBe(false)
    expect(toRows(grid, m)).toHaveLength(2)
  })

  it('ไม่มีคอลัมน์ผู้จ่าย → ใช้ชื่อลูกค้าเป็นผู้จ่าย ไม่ปล่อยว่าง', () => {
    const rows = toRows([['น้องปลา']], { header: false, name: 0, payer: -1, line: -1, price: -1 })
    expect(rows[0].clientName).toBe('น้องปลา')
  })

  it('แถวที่ไม่มีชื่อถูกทำเครื่องหมายว่าใช้ไม่ได้ ไม่ใช่เงียบ ๆ ข้าม', () => {
    const rows = toRows([['', 'คุณแม่']], { header: false, name: 0, payer: 1, line: -1, price: -1 })
    expect(rows[0].error).toBeTruthy()
  })

  it('ราคาที่มีคอมมาหรือคำว่าบาทยังอ่านออก · ค่าที่ไม่ใช่ราคาไม่ถูกเดา', () => {
    expect(parsePrice('1,200 บาท')).toBe(1200)
    expect(parsePrice('฿450')).toBe(450)
    expect(parsePrice('400.4')).toBeUndefined()
    expect(parsePrice('ฟรี')).toBeUndefined()
    expect(parsePrice('0')).toBeUndefined()
    expect(parsePrice('')).toBeUndefined()
  })
})

describe('ส่งออกแล้วนำกลับเข้ามาได้', () => {
  it('CSV ที่แอปส่งออกอ่านกลับเข้ามาแล้วได้ชื่อและราคาเท่าเดิม', () => {
    const state = buildScenario('default')
    const grid = parseDelimited(rosterCsv(state))
    const map = detectMapping(grid)
    expect(map.header).toBe(true)
    const rows = toRows(grid, map)
    expect(rows).toHaveLength(state.subjects.length)
    expect(rows.every((r) => !r.error)).toBe(true)
    expect(rows.map((r) => r.name)).toEqual(state.subjects.map((s) => s.name))
    // ราคาที่อ่านกลับต้องตรงกับที่ตั้งไว้จริง ไม่ใช่ 0 หรือ undefined
    const first = state.subjects[0]
    const price = first.billing.mode === 'per_unit' ? first.billing.rate
      : first.billing.mode === 'flat_monthly' ? first.billing.amount : first.billing.price
    expect(rows[0].price).toBe(price)
  })

  it('นำเข้าจริงแล้วรายชื่อเข้าไปในแอปครบ พร้อมราคารายคน', () => {
    let s = buildScenario('empty')
    const ok = reducer(s, {
      type: 'bulkAddSubjects',
      billing: { mode: 'per_unit', rate: 400 },
      rows: [
        { name: 'น้องปลา', clientName: 'คุณแม่ปลา' },
        { name: 'น้องต้น', clientName: 'คุณพ่อต้น', billing: { mode: 'per_unit', rate: 550 } },
      ],
    })
    expect(ok.subjects).toHaveLength(2)
    expect(ok.subjects[0].billing).toEqual({ mode: 'per_unit', rate: 400 })
    expect(ok.subjects[1].billing).toEqual({ mode: 'per_unit', rate: 550 })
    // ราคารายคนที่ไม่ถูกต้องต้องทำให้ทั้งชุดไม่เข้า ไม่ใช่เข้าครึ่งเดียว
    s = reducer(s, {
      type: 'bulkAddSubjects', billing: { mode: 'per_unit', rate: 400 },
      rows: [{ name: 'ก', clientName: 'ข' }, { name: 'ค', clientName: 'ง', billing: { mode: 'per_unit', rate: -1 } }],
    })
    expect(s.subjects).toHaveLength(0)
  })
})
