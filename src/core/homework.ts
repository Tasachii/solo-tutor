import type { AppState, HomeworkItem, ISODate, Message } from './types'
import { clientById, subjectById } from './ledger'
import { diffDays } from './format'

/**
 * การบ้าน — ledger เล็ก ๆ ที่ไม่มีเงิน แต่ใช้กติกาเดียวกับบิล:
 * สถานะ derive จากข้อมูล (วันนี้ vs กำหนดส่ง vs ส่งแล้ว) ไม่ใช่ flag ที่ตั้งเอง
 * ร่างทวงเกิดอัตโนมัติเมื่อเลยกำหนดและถอนตัวเองเมื่อครูทำเครื่องหมายว่าได้รับแล้ว
 */
export const HOMEWORK_TEXT_MAX = 1000
export const HOMEWORK_DEFAULT_DUE_DAYS = 3

export type HomeworkStatus = 'pending' | 'overdue' | 'submitted'

export const homeworkOf = (s: AppState): HomeworkItem[] => s.homework ?? []

export const homeworkStatus = (item: HomeworkItem, today: ISODate): HomeworkStatus =>
  item.submittedAt ? 'submitted' : today > item.dueAt ? 'overdue' : 'pending'

/** เลยกำหนดมากี่วัน — วันครบกำหนดเองยังไม่นับว่าเลย */
export const homeworkDaysLate = (item: HomeworkItem, today: ISODate): number =>
  item.submittedAt ? 0 : Math.max(diffDays(today, item.dueAt), 0)

export const homeworkReminderKey = (item: HomeworkItem): string => `hwrem:${item.id}`
export const homeworkAssignKey = (item: HomeworkItem): string => `hw:${item.id}`

/** ข้อความ homework/homework_reminder ต้องชี้การบ้านที่มีจริงและตรงคน — ใช้ทั้ง validation และ retract */
export function homeworkOfMessage(s: AppState, m: Message): HomeworkItem | undefined {
  if (m.kind !== 'homework' && m.kind !== 'homework_reminder') return undefined
  const id = m.meta?.homeworkId
  const item = typeof id === 'string' ? homeworkOf(s).find(h => h.id === id) : undefined
  return item && item.clientId === m.clientId && item.subjectId === m.subjectId ? item : undefined
}

export interface HomeworkRow {
  item: HomeworkItem
  subjectName: string
  clientName: string
  status: HomeworkStatus
  daysLate: number
  /** ร่างมอบหมายที่ยังไม่ส่ง (ถ้ามี) */
  assignDraft?: Message
  /** ร่างทวงที่รอส่ง (อัตโนมัติหรือครูกดทวงอีกครั้ง) */
  reminderDraft?: Message
  /** ทวงครั้งล่าสุดที่ส่งไปแล้ว */
  lastReminderAt?: ISODate
  /** ข้อความมอบหมายส่งไปแล้วเมื่อ */
  assignedSentAt?: ISODate
}

/** เรียงตามสิ่งที่ต้องลงมือก่อน: เลยกำหนดนานสุด → ใกล้ครบกำหนด → ส่งแล้ว (ล่าสุดก่อน) */
export function homeworkRows(s: AppState): HomeworkRow[] {
  const rows = homeworkOf(s).map((item): HomeworkRow => {
    const mine = s.messages.filter(m => m.meta?.homeworkId === item.id)
    const reminders = mine.filter(m => m.kind === 'homework_reminder')
    const assign = mine.find(m => m.kind === 'homework')
    const sentReminders = reminders.filter(m => m.status === 'sent').map(m => m.sentAt ?? m.createdAt).sort()
    return {
      item,
      subjectName: subjectById(s, item.subjectId)?.name ?? '—',
      clientName: clientById(s, item.clientId)?.name ?? '—',
      status: homeworkStatus(item, s.today),
      daysLate: homeworkDaysLate(item, s.today),
      assignDraft: assign?.status === 'draft' ? assign : undefined,
      reminderDraft: reminders.find(m => m.status === 'draft'),
      lastReminderAt: sentReminders.at(-1),
      assignedSentAt: assign?.status === 'sent' ? assign.sentAt ?? assign.createdAt : undefined,
    }
  })
  const rank: Record<HomeworkStatus, number> = { overdue: 0, pending: 1, submitted: 2 }
  return rows.sort((a, b) => rank[a.status] - rank[b.status]
    || (a.status === 'overdue' ? b.daysLate - a.daysLate
      : a.status === 'pending' ? a.item.dueAt.localeCompare(b.item.dueAt)
        : (b.item.submittedAt ?? '').localeCompare(a.item.submittedAt ?? ''))
    || a.item.id.localeCompare(b.item.id))
}

export interface HomeworkSummary { pending: number; overdue: number; submitted: number }
export const homeworkSummary = (s: AppState): HomeworkSummary => {
  const out: HomeworkSummary = { pending: 0, overdue: 0, submitted: 0 }
  for (const item of homeworkOf(s)) out[homeworkStatus(item, s.today)] += 1
  return out
}
