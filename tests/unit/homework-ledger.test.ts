import { describe, expect, it } from 'vitest'
import { buildScenario } from '../../src/core/scenarios'
import { reducer } from '../../src/core/store'
import { addDays } from '../../src/core/format'
import { homeworkOf, homeworkRows, homeworkStatus, homeworkSummary } from '../../src/core/homework'
import { deriveDrafts } from '../../src/core/messages'
import { validateState } from '../../src/core/validation'
import { fromBackup, toBackup } from '../../src/core/backup'
import { migrateCanonical } from '../../src/core/migrations'
import { professions } from '../../src/professions'
import type { AppState } from '../../src/core/types'

/** การบ้าน — ledger เล็กที่ derive สถานะและร่างทวงเหมือนบิล ไม่แตะเงิน */
const base = () => reducer(buildScenario('default'), { type: 'track', name: 'init' })
const drafts = (s: AppState, kind: string) => s.messages.filter(m => m.kind === kind && m.status === 'draft')

describe('ชุดเดโม', () => {
  it('มีการบ้านตัวอย่างสองรายการโดยไม่เพิ่มร่างใหม่ในคิว (จำนวนร่างเริ่มต้นเท่าเดิม = 3)', () => {
    const s = base()
    expect(homeworkOf(s)).toHaveLength(2)
    expect(homeworkSummary(s)).toEqual({ overdue: 1, pending: 1, submitted: 0 })
    expect(s.messages.filter(m => m.status === 'draft')).toHaveLength(3)
    expect(validateState(s).ok).toBe(true)
    const rows = homeworkRows(s)
    expect(rows[0].status).toBe('overdue')
    expect(rows[0].lastReminderAt).toBe(addDays(s.today, -1))
    expect(rows[0].assignedSentAt).toBeTruthy()
  })
})

describe('addHomework', () => {
  it('มอบหมายหลายคนครั้งเดียว → หนึ่งรายการ + หนึ่งร่างต่อคน ข้อความมีกำหนดส่งและคำลงท้ายของครู', () => {
    let s = base()
    const before = drafts(s, 'homework').length
    const dueAt = addDays(s.today, 3)
    s = reducer(s, { type: 'addHomework', subjectIds: ['s1', 's3', 's1'], text: '  ทำโจทย์หน้า 20 ข้อ 1–5  ', dueAt })
    const added = homeworkOf(s).filter(h => h.text === 'ทำโจทย์หน้า 20 ข้อ 1–5')
    expect(added).toHaveLength(2)
    expect(added.map(h => h.subjectId).sort()).toEqual(['s1', 's3'])
    for (const item of added) {
      expect(item.assignedAt).toBe(s.today)
      expect(item.dueAt).toBe(dueAt)
      expect(homeworkStatus(item, s.today)).toBe('pending')
      const draft = s.messages.find(m => m.kind === 'homework' && m.meta?.homeworkId === item.id)!
      expect(draft.status).toBe('draft')
      expect(draft.clientId).toBe(item.clientId)
      expect(draft.subjectId).toBe(item.subjectId)
      expect(draft.draft).toContain('ทำโจทย์หน้า 20 ข้อ 1–5')
      expect(draft.draft).toContain('ครับ')
      expect(draft.draft).not.toMatch(/ระบบ|อัตโนมัติ|Solo|\{|คุณคุณ/)
    }
    expect(drafts(s, 'homework')).toHaveLength(before + 2)
    expect(validateState(s).ok).toBe(true)
  })

  it('ปฏิเสธข้อความว่าง กำหนดส่งย้อนหลัง นักเรียนที่ไม่มี/หยุดเรียน', () => {
    const s = base()
    expect(reducer(s, { type: 'addHomework', subjectIds: ['s1'], text: '   ', dueAt: s.today })).toBe(s)
    expect(reducer(s, { type: 'addHomework', subjectIds: ['s1'], text: 'x', dueAt: addDays(s.today, -1) })).toBe(s)
    expect(reducer(s, { type: 'addHomework', subjectIds: ['s1'], text: 'x', dueAt: 'not-a-date' })).toBe(s)
    expect(reducer(s, { type: 'addHomework', subjectIds: [], text: 'x', dueAt: s.today })).toBe(s)
    expect(reducer(s, { type: 'addHomework', subjectIds: ['nope'], text: 'x', dueAt: s.today })).toBe(s)
    const stopped = reducer(s, { type: 'deactivateSubject', subjectId: 's1' })
    expect(reducer(stopped, { type: 'addHomework', subjectIds: ['s1'], text: 'x', dueAt: s.today })).toBe(stopped)
    expect(reducer(s, { type: 'addHomework', subjectIds: ['s1'], text: 'x'.repeat(1001), dueAt: s.today })).toBe(s)
  })
})

describe('ทวงการบ้าน', () => {
  it('เลยกำหนดแล้วยังไม่ได้รับ → ร่างทวงเกิดเอง · ทำเครื่องหมายได้รับ → ร่างถอนเอง · ยกเลิกการรับ → กลับมา', () => {
    let s = base()
    s = reducer(s, { type: 'addHomework', subjectIds: ['s3'], text: 'อ่านบทที่ 4', dueAt: s.today })
    const item = homeworkOf(s).find(h => h.subjectId === 's3')!
    expect(drafts(s, 'homework_reminder').some(m => m.meta?.homeworkId === item.id)).toBe(false)
    // เดินวันไป 2 วัน — สถานะเป็นเลยกำหนด และร่างทวงมี "เลยมา 1 วัน" (วันครบกำหนดเองยังไม่นับ)
    s = reducer(s, { type: 'setToday', date: addDays(s.today, 1) })
    const reminder = drafts(s, 'homework_reminder').find(m => m.meta?.homeworkId === item.id)!
    expect(reminder).toBeTruthy()
    expect(reminder.dedupeKey).toBe(`hwrem:${item.id}`)
    expect(reminder.draft).toContain('อ่านบทที่ 4')
    expect(reminder.draft).toContain('เลยมา 1 วัน')
    expect(reminder.draft).not.toMatch(/ระบบ|อัตโนมัติ|Solo|\{/)
    // วันถัดไป ตัวเลขวันสะกิดตาม
    s = reducer(s, { type: 'setToday', date: addDays(s.today, 1) })
    expect(s.messages.find(m => m.id === reminder.id)!.draft).toContain('เลยมา 2 วัน')
    expect(homeworkRows(s).find(r => r.item.id === item.id)!.reminderDraft?.id).toBe(reminder.id)
    // ได้รับแล้ว → ร่างทวงหาย สถานะ submitted
    s = reducer(s, { type: 'homeworkSubmitted', id: item.id })
    expect(s.messages.some(m => m.id === reminder.id)).toBe(false)
    expect(homeworkStatus(homeworkOf(s).find(h => h.id === item.id)!, s.today)).toBe('submitted')
    expect(reducer(s, { type: 'homeworkSubmitted', id: item.id })).toBe(s)
    // ยกเลิกการรับ → ร่างทวงกลับมา (ถอนไม่ใช่ข้าม)
    s = reducer(s, { type: 'homeworkReopen', id: item.id })
    expect(drafts(s, 'homework_reminder').some(m => m.meta?.homeworkId === item.id)).toBe(true)
    expect(validateState(s).ok).toBe(true)
  })

  it('ร่างทวงที่ส่งแล้วไม่เกิดซ้ำเอง — ทวงอีกครั้งเป็นการกระทำของครู วันละใบ', () => {
    let s = base()
    const overdue = homeworkOf(s).find(h => h.id === 'hw-1')!
    expect(homeworkStatus(overdue, s.today)).toBe('overdue')
    expect(deriveDrafts(s).some(m => m.meta?.homeworkId === overdue.id)).toBe(false)
    s = reducer(s, { type: 'remindHomework', id: overdue.id })
    const manual = drafts(s, 'homework_reminder').find(m => m.meta?.homeworkId === overdue.id)!
    expect(manual.dedupeKey).toBe(`hwrem:${overdue.id}:${s.today}`)
    // มีร่างรออยู่แล้ว → ไม่สร้างเพิ่ม
    expect(reducer(s, { type: 'remindHomework', id: overdue.id })).toBe(s)
    // รายการที่ยังไม่เลยกำหนดทวงไม่ได้
    expect(reducer(s, { type: 'remindHomework', id: 'hw-2' })).toBe(s)
    // ส่งแล้วนับเป็นประวัติทวงล่าสุด
    s = reducer(s, { type: 'sendMessage', id: manual.id })
    expect(homeworkRows(s).find(r => r.item.id === overdue.id)!.lastReminderAt).toBe(s.today)
  })

  it('นักเรียนที่หยุดเรียนไม่ถูกทวงการบ้านอัตโนมัติ', () => {
    let s = base()
    s = reducer(s, { type: 'addHomework', subjectIds: ['s3'], text: 'งาน', dueAt: s.today })
    s = reducer(s, { type: 'deactivateSubject', subjectId: 's3' })
    s = reducer(s, { type: 'setToday', date: addDays(s.today, 2) })
    expect(drafts(s, 'homework_reminder').some(m => m.subjectId === 's3')).toBe(false)
  })
})

describe('ลบและความสัมพันธ์', () => {
  it('ลบการบ้าน → ร่างที่ยังไม่ส่งหายไปด้วย ประวัติที่ส่งแล้วเก็บไว้', () => {
    let s = base()
    s = reducer(s, { type: 'addHomework', subjectIds: ['s3'], text: 'งาน', dueAt: s.today })
    const item = homeworkOf(s).find(h => h.subjectId === 's3')!
    s = reducer(s, { type: 'deleteHomework', id: item.id })
    expect(homeworkOf(s).some(h => h.id === item.id)).toBe(false)
    expect(s.messages.some(m => m.meta?.homeworkId === item.id)).toBe(false)
    // ของเดโมที่ส่งไปแล้ว: ลบรายการ → ข้อความที่ส่งแล้วยังอยู่ (validation ของ message ต้องยังผ่าน)
    const before = s.messages.filter(m => m.meta?.homeworkId === 'hw-1' && m.status === 'sent').length
    s = reducer(s, { type: 'deleteHomework', id: 'hw-1' })
    expect(s.messages.filter(m => m.meta?.homeworkId === 'hw-1' && m.status === 'sent')).toHaveLength(before)
    expect(reducer(s, { type: 'deleteHomework', id: 'hw-1' })).toBe(s)
  })

  it('ลบนักเรียนทั้งคน → การบ้านของคนนั้นหายไปพร้อมกัน', () => {
    let s = reducer(buildScenario('empty'), { type: 'track', name: 'init' })
    s = reducer(s, { type: 'bulkAddSubjects', rows: [{ name: 'น้องเอ', clientName: 'คุณแม่เอ' }], billing: { mode: 'per_unit', rate: 400 } })
    const subject = s.subjects[0]
    s = reducer(s, { type: 'addHomework', subjectIds: [subject.id], text: 'งาน', dueAt: s.today })
    expect(homeworkOf(s)).toHaveLength(1)
    s = reducer(s, { type: 'deleteSubject', subjectId: subject.id })
    expect(homeworkOf(s)).toHaveLength(0)
    expect(validateState(s).ok).toBe(true)
  })

  it('validation ปฏิเสธการบ้านที่ชี้นักเรียนผิด ผู้จ่ายไม่ตรง หรือวันย้อนแย้ง และข้อความที่ชี้การบ้านที่ไม่มี', () => {
    const s = base()
    const bad = (patch: Partial<AppState>) => validateState({ ...s, ...patch }).ok
    expect(bad({ homework: [{ id: 'x', subjectId: 'nope', clientId: 'c1', text: 'a', assignedAt: s.today, dueAt: s.today }] })).toBe(false)
    expect(bad({ homework: [{ id: 'x', subjectId: 's1', clientId: 'c2', text: 'a', assignedAt: s.today, dueAt: s.today }] })).toBe(false)
    expect(bad({ homework: [{ id: 'x', subjectId: 's1', clientId: 'c1', text: 'a', assignedAt: s.today, dueAt: addDays(s.today, -1) }] })).toBe(false)
    expect(bad({ homework: [{ id: 'x', subjectId: 's1', clientId: 'c1', text: '', assignedAt: s.today, dueAt: s.today }] })).toBe(false)
    expect(bad({ homework: [{ id: 'x', subjectId: 's1', clientId: 'c1', text: 'a', assignedAt: s.today, dueAt: s.today },
      { id: 'x', subjectId: 's1', clientId: 'c1', text: 'b', assignedAt: s.today, dueAt: s.today }] })).toBe(false)
    // รายการที่ถูกต้องเพิ่มเข้าไป (ของเดโมเดิมต้องคงอยู่ เพราะข้อความที่ส่งแล้วยังอ้างถึง)
    expect(bad({ homework: [...s.homework!, { id: 'x', subjectId: 's1', clientId: 'c1', text: 'a', assignedAt: s.today, dueAt: s.today }] })).toBe(true)
    // ลบการบ้านทิ้งทั้งที่ยังมีข้อความอ้างถึง = ข้อมูลไม่สอดคล้อง
    expect(bad({ homework: [] })).toBe(false)
    const orphan = { ...s.messages[0], id: 'orphan', kind: 'homework_reminder' as const, dedupeKey: 'orphan', meta: { homeworkId: 'missing' } }
    expect(bad({ messages: [...s.messages, orphan] })).toBe(false)
  })

  it('ไฟล์สำรอง/ข้อมูลเก่าที่ไม่มี homework เปิดได้ และ backup ที่มี homework กู้กลับครบ', () => {
    const s = base()
    const legacy = { ...s }
    delete (legacy as Partial<AppState>).homework
    const legacyMessages = legacy.messages.filter(m => m.kind !== 'homework' && m.kind !== 'homework_reminder')
    expect(migrateCanonical({ ...legacy, messages: legacyMessages })).not.toBeNull()
    const restored = fromBackup(toBackup(s, '2026-09-08T00:00:00Z'), 5)
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.state.homework).toEqual(s.homework)
  })

  it('ทุกอาชีพมี template มอบหมายและทวงการบ้าน ไม่มีตัวแปรค้างและไม่มีคำต้องห้าม', () => {
    for (const prof of professions) {
      let s = reducer({ ...buildScenario('default'), professionId: prof.id }, { type: 'track', name: 'x' })
      s = reducer(s, { type: 'addHomework', subjectIds: ['s3'], text: 'งาน', dueAt: s.today })
      s = reducer(s, { type: 'setToday', date: addDays(s.today, 1) })
      for (const m of s.messages.filter(x => x.kind === 'homework' || x.kind === 'homework_reminder')) {
        expect(m.draft).not.toContain('{')
        expect(m.draft).not.toMatch(/ระบบ|อัตโนมัติ|Solo/)
      }
    }
  })
})
