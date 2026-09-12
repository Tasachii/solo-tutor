import type { AppState, Client, ServiceUnit, Subject } from '../core/types'
import { PROMPTPAY_DISPLAY, PROVIDER_NAME } from '../platform/config'
import { addDays, dayIn, daysInPeriod, iso, parseISO, periodOf, todayISO, weekday } from '../core/format'

/**
 * เดโมเดินตามนาฬิกาเครื่อง — กรรมการเปิดดูวันไหนก็เห็นเดือนนั้น
 * เคยล็อกไว้ที่ 2 ก.ย. 2568 แล้วปีถัดมาข้อมูลกลายเป็นของปีที่แล้วทั้งจอ
 * เทสตรึงนาฬิกาแทน (unit: tests/setup.ts · e2e: page.clock) ตัวเลขในเทสจึงไม่ต้องขยับ
 */
export const demoToday = (): string => todayISO()

/** เดือนนี้และเดือนก่อน — ขอบเขตที่ชุดข้อมูลเดโมครอบคลุม */
export const thisPeriod = (): string => periodOf(demoToday())
export function periodBack(n: number, from: string = thisPeriod()): string {
  const [y, m] = from.split('-').map(Number)
  const total = y * 12 + (m - 1) - n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** วันสุดท้ายของเดือนและวันที่ `day` ของเดือนนั้น — ตัวจริงอยู่ใน core/format.ts (ปฏิทินใช้ตัวเดียวกัน) */
export { daysInPeriod, dayIn } from '../core/format'

export const emptyBase = (): AppState => ({
  schemaVersion: 5, revision: 0, mode: 'demo', professionId: 'tutor', scenarioId: 'empty',
  provider: { name: PROVIDER_NAME, promptpayId: PROMPTPAY_DISPLAY },
  today: demoToday(),
  clients: [], subjects: [], units: [], completions: [],
  invoices: [], payments: [], receipts: [], messages: [], chats: [],
  waitlist: [], events: [], counters: { receipt: 0, invoice: 0 }, onboarded: true,
})

/** ทุกวันที่ระหว่าง START..END ที่ตรงกับวันในสัปดาห์ */
function datesOn(days: number[], start: string, end: string): string[] {
  const out: string[] = []
  let d = start
  while (d <= end) {
    if (days.includes(weekday(d))) out.push(d)
    d = addDays(d, 1)
  }
  return out
}

export interface SubjectPlan {
  id: string; name: string; clientId: string; clientName: string
  billing: Subject['billing']; label: string
  days: number[]; time: string
  /** จำนวนครั้งทั้งคอร์ส — ตั้งไว้ในชุดตัวอย่างเพื่อให้ "สอนไปแล้ว x/N" อ่านแล้วสมจริง ไม่ใช่ 10/10 ทุกคน */
  courseSessions?: number
  /** จำนวน completion ที่ต้องเกิดในเดือน (ล็อกให้ตัวเลขตรง spec) */
  augDone: number; sepDoneBeforeToday: number
  /** มีคาบวันนี้ไหม และเช็คไปแล้วหรือยัง */
  todayUnit?: { time: string; done: boolean }
}

export function buildFromPlans(plans: SubjectPlan[], scenarioId: string): AppState {
  const today = demoToday()
  const period = periodOf(today)
  const prev = periodBack(1, period)
  const START = dayIn(prev, 1)
  const END = dayIn(period, daysInPeriod(period))
  const s = emptyBase()
  s.scenarioId = scenarioId
  const clients = new Map<string, Client>()
  const subjects: Subject[] = []
  const units: ServiceUnit[] = []
  const completions: AppState['completions'] = []

  for (const p of plans) {
    if (!clients.has(p.clientId)) clients.set(p.clientId, { id: p.clientId, name: p.clientName, lineId: `@${p.clientId}` })
    subjects.push({
      id: p.id, name: p.name, clientId: p.clientId, billing: p.billing,
      label: p.label, active: true, createdAt: START,
      ...(p.courseSessions !== undefined ? { courseSessions: p.courseSessions } : {}),
    })

    const dates = datesOn(p.days, START, END)
    const mine: ServiceUnit[] = dates.map((d, i) => ({
      id: `u-${p.id}-${i}`, subjectId: p.id, scheduledAt: d, time: p.time, durationMin: 60, label: p.label,
    }))
    // คาบวันนี้ที่ spec บังคับว่าต้องมี แม้ pattern ไม่ตรงวัน
    if (p.todayUnit && !mine.some((u) => u.scheduledAt === today)) {
      mine.push({ id: `u-${p.id}-today`, subjectId: p.id, scheduledAt: today, time: p.todayUnit.time, durationMin: 60, label: p.label })
    }
    units.push(...mine)

    const aug = mine.filter((u) => u.scheduledAt.startsWith(prev)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    for (const u of aug.slice(0, p.augDone)) completions.push({ unitId: u.id, completedAt: u.scheduledAt })

    const sepBefore = mine.filter((u) => u.scheduledAt.startsWith(period) && u.scheduledAt < today)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    for (const u of sepBefore.slice(0, p.sepDoneBeforeToday)) completions.push({ unitId: u.id, completedAt: u.scheduledAt })

    if (p.todayUnit?.done) {
      const t = mine.find((u) => u.scheduledAt === today)
      if (t) completions.push({ unitId: t.id, completedAt: today })
    }
  }

  s.clients = [...clients.values()]
  s.subjects = subjects
  s.units = units.sort((a, b) => (a.scheduledAt + a.time).localeCompare(b.scheduledAt + b.time))
  s.completions = completions
  return s
}

export const isoOf = iso
export const parse = parseISO
