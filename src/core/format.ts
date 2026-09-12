// แสดงผลวันที่/เงินแบบไทย — เก็บ ค.ศ. ภายใน แสดง พ.ศ. เสมอ
const TH_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const TH_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
export const TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']

const nf = new Intl.NumberFormat('en-US')
export const money = (n: number): string => nf.format(Math.round(n))

export function parseISO(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number)
  return { y, m, day }
}
export const pad = (n: number): string => String(n).padStart(2, '0')
export const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`

/** วันนี้ตามนาฬิกาเครื่อง — ห้ามใช้ toISOString เพราะมันคืนวัน UTC */
export const todayISO = (d: Date = new Date()): string =>
  iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
export const periodOf = (d: string): string => d.slice(0, 7)

export function weekday(d: string): number {
  const { y, m, day } = parseISO(d)
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay()
}
export function addDays(d: string, n: number): string {
  const { y, m, day } = parseISO(d)
  const t = new Date(Date.UTC(y, m - 1, day + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
export function diffDays(a: string, b: string): number {
  const pa = parseISO(a); const pb = parseISO(b)
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.day) - Date.UTC(pb.y, pb.m - 1, pb.day)) / 86400000)
}
/** จำนวนวันของเดือนนั้น — กันวันที่ 31 หล่นไปเดือนถัดไปตอนเดือนนั้นมี 30 วัน */
export const daysInPeriod = (period: string): number => {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
/** วันที่ `day` ของ period นั้น — เกินสิ้นเดือนให้ยึดสิ้นเดือน */
export const dayIn = (period: string, day: number): string =>
  `${period}-${pad(Math.min(day, daysInPeriod(period)))}`
/** เลื่อนเดือน: shiftPeriod('2025-12', 1) → '2026-01' */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
}
/**
 * ช่องทั้งหมดของตารางปฏิทินเดือนนั้น เรียงตามสัปดาห์ที่เริ่มวันอาทิตย์
 * null = ช่องว่างก่อนวันที่ 1 (ไม่เติมวันของเดือนข้างเคียง ครูจะได้ไม่กดผิดเดือน)
 * คำนวณจาก string ล้วน ไม่แตะนาฬิกาเครื่อง — เทสตรึงวันได้และ CI ที่รัน UTC ได้ผลเท่ากัน
 */
export function monthGrid(period: string): (string | null)[] {
  const first = dayIn(period, 1)
  const lead = weekday(first)
  const days = daysInPeriod(period)
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(dayIn(period, day))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** "2 ก.ย." */
export function dateThai(d: string): string {
  const { m, day } = parseISO(d)
  return `${day} ${TH_MONTH_SHORT[m - 1]}`
}
/** "อังคาร" */
export const dayThai = (d: string): string => TH_DAY[weekday(d)]
/** period "2025-09" → "ก.ย. 2568" */
export function periodThai(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${TH_MONTH_SHORT[m - 1]} ${y + 543}`
}
/** "กันยายน 2568" */
export function periodThaiFull(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${TH_MONTH_FULL[m - 1]} ${y + 543}`
}
/** "วันอังคารที่ 2 กันยายน 2568" */
export function dateThaiFull(d: string): string {
  const { y, m, day } = parseISO(d)
  return `วัน${TH_DAY[weekday(d)]}ที่ ${day} ${TH_MONTH_FULL[m - 1]} ${y + 543}`
}
