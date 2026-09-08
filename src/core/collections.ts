import type { AppState, Invoice, ISODate, Message, MessageKind } from './types'
import { balanceDue, clientById, subjectById } from './ledger'
import { daysOverdue, ladderFor } from './billing'

/**
 * แท็บ "ทวงเงิน" — มุมมองเดียวที่รวมบิลค้างทุกใบ ขั้นทวง ร่างที่รอส่ง และประวัติทวง
 * ตัวเลขทุกตัวมาจาก ledger (หลักการข้อ 2) ที่นี่แค่จัดเรียงและจับคู่ ไม่คำนวณเงินใหม่
 */
export type Ladder = 'soft' | 'clear' | 'final'

export interface CollectionRow {
  invoice: Invoice
  subjectName: string
  clientName: string
  /** ยอดคงเหลือหลังหักงวดที่จ่ายแล้ว */
  balance: number
  daysOverdue: number
  dueAt?: ISODate
  /** ขั้นทวงที่เข้าเงื่อนไขวันนี้ — null = ยังไม่ถึงกำหนด */
  ladder: Ladder | null
  /** ร่างที่รอส่งของบิลนี้ (ทวงตามบันไดก่อน แล้วค่อยเตือนสั้น) */
  draft?: Message
  /** ทวงครั้งล่าสุดที่ส่งไปแล้ว */
  lastReminder?: { at: ISODate; kind: MessageKind }
  /** ส่งทวงไปแล้วกี่ครั้ง (ทุกชนิด) */
  remindersSent: number
}

const REMINDER_KINDS: MessageKind[] = ['reminder', 'nudge']

export const nudgeKey = (invoiceId: string, today: ISODate): string => `nudge:${invoiceId}:${today}`

export function collectionRows(s: AppState): CollectionRow[] {
  const rows = s.invoices
    .filter(inv => inv.kind === 'monthly' && (inv.status === 'sent' || inv.status === 'overdue'))
    .map((invoice): CollectionRow => {
      const mine = s.messages.filter(m => REMINDER_KINDS.includes(m.kind) && m.meta?.invoiceId === invoice.id)
      const sent = mine.filter(m => m.status === 'sent')
        .map(m => ({ at: m.sentAt ?? m.createdAt, kind: m.kind }))
        .sort((a, b) => a.at.localeCompare(b.at))
      const drafts = mine.filter(m => m.status === 'draft')
      return {
        invoice,
        subjectName: subjectById(s, invoice.subjectId)?.name ?? '—',
        clientName: clientById(s, invoice.clientId)?.name ?? '—',
        balance: balanceDue(s, invoice.id),
        daysOverdue: daysOverdue(s, invoice),
        dueAt: invoice.dueAt,
        ladder: ladderFor(s, invoice),
        draft: drafts.find(m => m.kind === 'reminder') ?? drafts[0],
        lastReminder: sent.at(-1),
        remindersSent: sent.length,
      }
    })
  return rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance || a.invoice.id.localeCompare(b.invoice.id))
}

export interface CollectionSummary {
  count: number
  outstanding: number
  /** ค้างเกิน 7 วัน — ตัวเลขที่ครูควรลงมือก่อน */
  overSeven: number
  withDraft: number
}

export function collectionSummary(rows: CollectionRow[]): CollectionSummary {
  return {
    count: rows.length,
    outstanding: rows.reduce((sum, row) => sum + row.balance, 0),
    overSeven: rows.filter(row => row.daysOverdue > 7).length,
    withDraft: rows.filter(row => !!row.draft).length,
  }
}
