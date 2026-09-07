/**
 * ตัวเข้ารหัส QR ขนาดเล็ก — byte mode, ระดับกันพลาด M, เวอร์ชัน 1–10
 * เขียนเองเพราะโปรเจกต์ไม่รับ dependency เพิ่ม และ payload พร้อมเพย์สั้นพอ
 * ที่จะอยู่ในช่วงนี้เสมอ (ยาวสุดราว 100 ตัวอักษร)
 */

/** ข้อมูล/แท่งกันพลาดต่อเวอร์ชัน ที่ระดับ M — [ec ต่อบล็อก, บล็อกกลุ่ม 1, ข้อมูลต่อบล็อก, บล็อกกลุ่ม 2] */
const LEVEL_M: readonly (readonly [number, number, number, number])[] = [
  [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0],
  [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1],
]

/** จุดกึ่งกลางลายจัดตำแหน่งของแต่ละเวอร์ชัน */
const ALIGNMENT: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i += 1) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

function generatorPoly(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      // poly[0] คือสัมประสิทธิ์ดีกรีสูงสุด — คูณด้วย (x + α^i) แล้วพจน์ x ต้องอยู่ที่ index เดิม
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function ecCodewords(data: number[], count: number): number[] {
  const poly = generatorPoly(count)
  const remainder = new Array<number>(count).fill(0)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    remainder.shift()
    remainder.push(0)
    for (let i = 0; i < count; i += 1) remainder[i] ^= mul(poly[i + 1], factor)
  }
  return remainder
}

const dataCapacity = (version: number): number => {
  const [, blocks1, perBlock, blocks2] = LEVEL_M[version - 1]
  return blocks1 * perBlock + blocks2 * (perBlock + 1)
}

/** เวอร์ชันเล็กที่สุดที่ใส่ข้อมูลได้ — null เมื่อยาวเกินเวอร์ชัน 10 */
export function pickVersion(byteLength: number): number | null {
  for (let version = 1; version <= LEVEL_M.length; version += 1) {
    const headerBits = 4 + (version >= 10 ? 16 : 8)
    if (headerBits + byteLength * 8 <= dataCapacity(version) * 8) return version
  }
  return null
}

export function encodeData(bytes: number[], version: number): number[] {
  const capacity = dataCapacity(version)
  const bits: number[] = []
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version >= 10 ? 16 : 8)
  for (const byte of bytes) push(byte, 8)

  const limit = capacity * 8
  for (let i = 0; i < 4 && bits.length < limit; i += 1) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0))
  }
  for (let i = 0; codewords.length < capacity; i += 1) codewords.push(i % 2 === 0 ? 0xec : 0x11)
  return codewords
}

/** สลับข้อมูลและแท่งกันพลาดตามลำดับที่สเปกกำหนด */
export function interleave(codewords: number[], version: number): number[] {
  const [ecPerBlock, blocks1, perBlock, blocks2] = LEVEL_M[version - 1]
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  let offset = 0
  for (let i = 0; i < blocks1 + blocks2; i += 1) {
    const size = i < blocks1 ? perBlock : perBlock + 1
    const block = codewords.slice(offset, offset + size)
    offset += size
    dataBlocks.push(block)
    ecBlocks.push(ecCodewords(block, ecPerBlock))
  }
  const out: number[] = []
  const longest = Math.max(...dataBlocks.map((block) => block.length))
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i])
  }
  return out
}

type Grid = { size: number; modules: Int8Array; reserved: Uint8Array }

const at = (g: Grid, x: number, y: number): number => g.modules[y * g.size + x]
const set = (g: Grid, x: number, y: number, value: number, reserve = true) => {
  g.modules[y * g.size + x] = value
  if (reserve) g.reserved[y * g.size + x] = 1
}

function placeFunctionPatterns(g: Grid, version: number): void {
  const finder = (ox: number, oy: number) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const px = ox + x
        const py = oy + y
        if (px < 0 || py < 0 || px >= g.size || py >= g.size) continue
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
        set(g, px, py, ring === 2 || ring > 3 ? 0 : 1)
      }
    }
  }
  finder(0, 0)
  finder(g.size - 7, 0)
  finder(0, g.size - 7)

  for (let i = 8; i < g.size - 8; i += 1) {
    const value = i % 2 === 0 ? 1 : 0
    set(g, i, 6, value)
    set(g, 6, i, value)
  }

  // ข้ามเฉพาะสามจุดที่ทับ finder — จุดที่นั่งอยู่บนแถว/คอลัมน์ timing ต้องวาด (เวอร์ชัน 7 ขึ้นไป)
  const centers = ALIGNMENT[version - 1]
  const last = centers[centers.length - 1]
  for (const cy of centers) {
    for (const cx of centers) {
      const onFinder = (cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)
      if (onFinder) continue
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          set(g, cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) === 1 ? 0 : 1)
        }
      }
    }
  }

  // ช่องข้อมูลรูปแบบ กันไว้ก่อน เขียนค่าจริงหลังเลือก mask ได้แล้ว
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) set(g, i, 8, 0)
    if (i !== 6) set(g, 8, i, 0)
  }
  for (let i = 0; i < 8; i += 1) {
    set(g, g.size - 1 - i, 8, 0)
    set(g, 8, g.size - 1 - i, 0)
  }
  set(g, 8, g.size - 8, 1) // โมดูลดำถาวร

  if (version >= 7) {
    let remainder = version
    for (let i = 0; i < 12; i += 1) {
      remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25)
    }
    const info = (version << 12) | remainder
    for (let i = 0; i < 18; i += 1) {
      const bit = (info >> i) & 1
      set(g, Math.floor(i / 3), g.size - 11 + (i % 3), bit)
      set(g, g.size - 11 + (i % 3), Math.floor(i / 3), bit)
    }
  }
}

function placeData(g: Grid, codewords: number[]): void {
  let bitIndex = 0
  const nextBit = (): number => {
    const byte = codewords[bitIndex >> 3]
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1
    bitIndex += 1
    return bit
  }
  let upward = true
  for (let right = g.size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1 // คอลัมน์ timing ข้ามไป
    for (let step = 0; step < g.size; step += 1) {
      const y = upward ? g.size - 1 - step : step
      for (const x of [right, right - 1]) {
        if (g.reserved[y * g.size + x]) continue
        set(g, x, y, nextBit(), false)
      }
    }
    upward = !upward
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function penalty(g: Grid): number {
  const { size } = g
  let score = 0

  const runScore = (line: number[]) => {
    let run = 1
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1
        continue
      }
      if (run >= 5) score += run - 2
      run = 1
    }
    if (run >= 5) score += run - 2
  }
  for (let i = 0; i < size; i += 1) {
    runScore(Array.from({ length: size }, (_, j) => at(g, j, i)))
    runScore(Array.from({ length: size }, (_, j) => at(g, i, j)))
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const first = at(g, x, y)
      if (first === at(g, x + 1, y) && first === at(g, x, y + 1) && first === at(g, x + 1, y + 1)) score += 3
    }
  }

  const finderLike = [1, 0, 1, 1, 1, 0, 1]
  const hasPattern = (line: number[], start: number): boolean =>
    finderLike.every((bit, i) => line[start + i] === bit)
  for (let i = 0; i < size; i += 1) {
    const row = Array.from({ length: size }, (_, j) => at(g, j, i))
    const column = Array.from({ length: size }, (_, j) => at(g, i, j))
    for (const line of [row, column]) {
      for (let start = 0; start + 7 <= size; start += 1) {
        if (!hasPattern(line, start)) continue
        const before = line.slice(Math.max(0, start - 4), start)
        const after = line.slice(start + 7, start + 11)
        if (before.length === 4 && before.every((bit) => bit === 0)) score += 40
        if (after.length === 4 && after.every((bit) => bit === 0)) score += 40
      }
    }
  }

  let dark = 0
  for (let i = 0; i < size * size; i += 1) dark += g.modules[i]
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
  return score
}

function writeFormat(g: Grid, mask: number): void {
  const data = (0b00 << 3) | mask // ระดับ M = 00
  let remainder = data
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537)
  const bits = ((data << 10) | remainder) ^ 0x5412

  for (let i = 0; i <= 5; i += 1) set(g, 8, i, (bits >> i) & 1)
  set(g, 8, 7, (bits >> 6) & 1)
  set(g, 8, 8, (bits >> 7) & 1)
  set(g, 7, 8, (bits >> 8) & 1)
  for (let i = 9; i < 15; i += 1) set(g, 14 - i, 8, (bits >> i) & 1)

  for (let i = 0; i < 8; i += 1) set(g, g.size - 1 - i, 8, (bits >> i) & 1)
  for (let i = 8; i < 15; i += 1) set(g, 8, g.size - 15 + i, (bits >> i) & 1)
  set(g, 8, g.size - 8, 1)
}

/** เมทริกซ์ QR — true = โมดูลดำ · null เมื่อข้อความยาวเกินเวอร์ชัน 10 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text))
  const version = pickVersion(bytes.length)
  if (version === null) return null

  const codewords = interleave(encodeData(bytes, version), version)
  const size = version * 4 + 17

  let best: { grid: Grid; score: number } | null = null
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    const grid: Grid = { size, modules: new Int8Array(size * size), reserved: new Uint8Array(size * size) }
    placeFunctionPatterns(grid, version)
    placeData(grid, codewords)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (grid.reserved[y * size + x]) continue
        if (MASKS[mask](x, y)) grid.modules[y * size + x] ^= 1
      }
    }
    writeFormat(grid, mask)
    const score = penalty(grid)
    if (!best || score < best.score) best = { grid, score }
  }

  const { grid } = best!
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => at(grid, x, y) === 1))
}

/** เส้นทาง SVG ของโมดูลดำทั้งหมด — ใช้ path เดียวเพื่อไม่ให้ DOM บวม */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = []
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix.length; x += 1) {
      if (matrix[y][x]) parts.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return parts.join('')
}
