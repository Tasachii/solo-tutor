import { describe, expect, it } from 'vitest'
import { reducer, migrate } from '../../src/core/store'
import { fromBackup, toBackup } from '../../src/core/backup'
import { buildScenario } from '../../src/core/scenarios'
import { buildInvoice, closablePeriods } from '../../src/core/billing'
import { packageStatus } from '../../src/core/ledger'
import { receiptDocument } from '../../src/core/documents'
import { validateState } from '../../src/core/validation'

describe('QA core regressions', () => {
  it('keeps an issued receipt immutable after provider and payer edits', () => {
    const base = buildScenario('default')
    const invoice = base.invoices.find(row => row.status === 'sent' || row.status === 'overdue')!
    const paid = reducer(base, { type: 'recordPayment', invoiceId: invoice.id, amount: invoice.total, slipVerified: false })
    const receipt = paid.receipts.at(-1)!
    const before = receiptDocument(paid, receipt.id)
    const subject = paid.subjects.find(row => row.id === invoice.subjectId)!
    const edited = reducer(paid, {
      type: 'upsertSubject', subject, clientName: 'ชื่อผู้จ่ายใหม่', lineId: null,
    })
    const renamed = reducer(edited, { type: 'setProvider', name: 'ชื่อผู้รับเงินใหม่', promptpayId: '0999999999' })
    expect(receiptDocument(renamed, receipt.id)).toEqual(before)
    expect(renamed.clients.find(row => row.id === subject.clientId)?.lineId).toBeUndefined()
  })

  it('marks a receipt verified only when every installment was verified', () => {
    const base = buildScenario('default')
    const invoice = base.invoices.find(row => row.status === 'sent' || row.status === 'overdue')!
    const partial = reducer(base, { type: 'recordPayment', invoiceId: invoice.id, amount: 1000, slipVerified: false })
    const settled = reducer(partial, { type: 'recordPayment', invoiceId: invoice.id, amount: invoice.total - 1000, slipVerified: true, slipAmount: invoice.total - 1000 })
    const snapshot = settled.receipts.at(-1)!.snapshot
    expect(snapshot.slipVerified).toBe(false)
    expect(snapshot.slipAmount).toBeUndefined()
  })

  it('migrates schema 3 and 4 through canonical schema 5 for storage and backups', () => {
    const v4 = { ...buildScenario('default'), schemaVersion: 4 } as any
    v4.receipts = v4.receipts.map(({ snapshot: _snapshot, ...receipt }: any) => receipt)
    const v3 = { ...v4, schemaVersion: 3 }
    delete v3.mode
    const migrated3 = migrate(v3)
    const migrated4 = migrate(v4)
    expect(migrated3).toMatchObject({ schemaVersion: 5, revision: 0, mode: 'demo' })
    expect(migrated4).toMatchObject({ schemaVersion: 5, revision: 0 })
    expect(migrated4?.receipts.every(receipt => receipt.snapshot.legacyBackfill)).toBe(true)
    const backup = JSON.parse(toBackup(v4, '2026-09-06T00:00:00.000Z'))
    backup.app = v3
    expect(fromBackup(JSON.stringify(backup), 5)).toMatchObject({ ok: true, state: { schemaVersion: 5 } })
    const corrupted = JSON.parse(toBackup(buildScenario('default'), '2026-09-06T00:00:00.000Z'))
    corrupted.app.receipts[0].snapshot.slipVerified = false
    expect(fromBackup(JSON.stringify(corrupted), 5)).toMatchObject({ ok: false, reason: 'wrongFile' })

    const currentWithoutSnapshot = JSON.parse(JSON.stringify(buildScenario('default')))
    delete currentWithoutSnapshot.receipts[0].snapshot
    expect(migrate(currentWithoutSnapshot)).toBeNull()

    const currentWithoutRevision = JSON.parse(JSON.stringify(buildScenario('default')))
    delete currentWithoutRevision.revision
    expect(migrate(currentWithoutRevision)).toBeNull()

    for (const mutate of [
      (app: any) => { app.messages[0].draft = '   ' },
      (app: any) => { app.messages[0].dedupeKey = '' },
      (app: any) => { app.clients[0].name = '\t' },
      (app: any) => { app.waitlist.push({ professionId: ' ', name: 'ชื่อ', contact: 'ไลน์', at: app.today }) },
      (app: any) => { app.events.push({ at: new Date().toISOString(), name: ' ' }) },
      (app: any) => { app.subjects.find((subject: any) => subject.billing.mode === 'flat_monthly').billing.effectiveFrom = 'not-a-date' },
      (app: any) => {
        const subject = app.subjects.find((row: any) => row.billing.mode === 'flat_monthly')
        subject.billing.effectiveFrom = '2000-01-01'
      },
    ]) {
      const malformed = JSON.parse(JSON.stringify(buildScenario('default')))
      mutate(malformed)
      expect(migrate(malformed)).toBeNull()
    }
  })

  it('preserves unused package credits separately from the next purchase', () => {
    let state = buildScenario('default')
    const subject = state.subjects.find(row => row.billing.mode === 'package')!
    const before = packageStatus(state, subject)!
    state = reducer(state, { type: 'renewPackage', subjectId: subject.id })
    const after = packageStatus(state, state.subjects.find(row => row.id === subject.id)!)!
    expect(after.purchasedUnits).toBe(subject.billing.mode === 'package' ? subject.billing.total : 0)
    expect(after.carriedCredits).toBe(before.remaining)
    expect(after.entitlementTotal).toBe(after.purchasedUnits + before.remaining)
    expect(state.payments.at(-1)?.slipVerified).toBe(false)
    expect(state.invoices.at(-1)?.lines[0].qty).toBe(after.purchasedUnits)
  })

  it('bills changed renewal terms without rewriting the old package and carries repeatedly', () => {
    let state = buildScenario('default')
    const subject = state.subjects.find(row => row.id === 's7')!
    const old = subject.billing
    if (old.mode !== 'package') throw new Error('fixture')
    const edited = { ...subject, billing: { ...old, total: 20, price: 6000 } }
    expect(reducer(state, { type: 'upsertSubject', subject: edited, clientName: state.clients.find(c => c.id === subject.clientId)!.name })).toBe(state)

    const oldRemaining = packageStatus(state, subject)!.remaining
    state = reducer(state, { type: 'renewPackage', subjectId: subject.id, total: 20, price: 6000 })
    let status = packageStatus(state, state.subjects.find(row => row.id === subject.id)!)!
    expect(status).toMatchObject({ purchasedUnits: 20, carriedCredits: oldRemaining, entitlementTotal: 20 + oldRemaining, price: 6000 })
    expect(state.invoices.at(-1)).toMatchObject({ total: 6000, lines: [{ qty: 20, amount: 6000 }] })

    const beforeRepeat = status.remaining
    state = reducer(state, { type: 'renewPackage', subjectId: subject.id, total: 10, price: 3500 })
    status = packageStatus(state, state.subjects.find(row => row.id === subject.id)!)!
    expect(status).toMatchObject({ purchasedUnits: 10, carriedCredits: beforeRepeat, entitlementTotal: 10 + beforeRepeat, price: 3500 })
    expect(state.invoices.at(-1)).toMatchObject({ total: 3500, lines: [{ qty: 10, amount: 3500 }] })
  })

  it('distinguishes opening package balance from an atomic paid purchase', () => {
    const empty = buildScenario('empty')
    const billing = { mode: 'package' as const, total: 10, price: 3500, purchasedAt: empty.today }
    const rows = [{ name: 'ลูกค้าใหม่', clientName: 'ผู้จ่ายใหม่' }]
    const opening = reducer(empty, { type: 'finishOnboarding', provider: { name: 'ครู', promptpayId: '0812345678' }, rows, billing, packageIntent: 'opening_balance' })
    expect(opening.subjects).toHaveLength(1)
    expect(opening.invoices).toHaveLength(0)
    const purchased = reducer(empty, { type: 'finishOnboarding', provider: { name: 'ครู', promptpayId: '0812345678' }, rows, billing, packageIntent: 'paid_purchase' })
    expect(purchased.invoices).toHaveLength(1)
    expect(purchased.payments).toHaveLength(1)
    expect(purchased.receipts).toHaveLength(1)
    expect(purchased.payments[0].slipVerified).toBe(false)

    const newSubject = {
      id: 'new-package', name: 'ลูกค้าแพ็ก', clientId: 'new-client', billing,
      active: true, createdAt: empty.today,
    }
    expect(reducer(empty, { type: 'upsertSubject', subject: newSubject, clientName: 'ผู้จ่าย' })).toBe(empty)
    expect(reducer(empty, { type: 'finishOnboarding', provider: { name: 'ครู', promptpayId: '' }, rows, billing })).toBe(empty)
  })

  it('does not mutate an existing payer while building an atomic onboarding transition', () => {
    const state = buildScenario('default')
    const payer = state.clients[0]
    const before = { ...payer }
    reducer(state, {
      type: 'finishOnboarding', provider: state.provider,
      rows: [{ name: 'คนใหม่', clientName: 'ชื่อใหม่', clientId: payer.id }],
      billing: { mode: 'per_unit', rate: 500 },
    })
    expect(payer).toEqual(before)
  })

  it('refuses payer changes after invoice history but permits them before invoicing', () => {
    const state = buildScenario('default')
    const invoiced = state.subjects.find(subject => state.invoices.some(invoice => invoice.subjectId === subject.id))!
    expect(reducer(state, {
      type: 'upsertSubject', subject: { ...invoiced, clientId: 'new-payer' }, clientName: 'ผู้จ่ายใหม่',
    })).toBe(state)

    const messageLinked = state.subjects.find(subject => !state.invoices.some(invoice => invoice.subjectId === subject.id)
      && state.messages.some(message => message.subjectId === subject.id))!
    expect(reducer(state, {
      type: 'upsertSubject', subject: { ...messageLinked, clientId: state.clients[0].id }, clientName: state.clients[0].name,
    })).toBe(state)

    const uninvoiced = state.subjects.find(subject => !state.invoices.some(invoice => invoice.subjectId === subject.id)
      && !state.messages.some(message => message.subjectId === subject.id))!
    const moved = reducer(state, {
      type: 'upsertSubject', subject: { ...uninvoiced, clientId: state.clients[0].id }, clientName: state.clients[0].name,
    })
    expect(moved.subjects.find(subject => subject.id === uninvoiced.id)?.clientId).toBe(state.clients[0].id)
    expect(validateState(moved).ok).toBe(true)
  })

  it('reconciles draft invoice totals and refuses finalized-period mutations', () => {
    let state = buildScenario('default')
    const subject = state.subjects.find(row => row.billing.mode === 'per_unit')!
    const period = state.today.slice(0, 7)
    const unit = state.units.find(row => row.subjectId === subject.id && row.scheduledAt.startsWith(period))!
    state = { ...state, invoices: [...state.invoices, buildInvoice(subject, period, state)!] }
    const updated = reducer(state, { type: 'complete', unitId: unit.id })
    expect(updated.invoices.find(row => row.subjectId === subject.id && row.period === period)?.total)
      .toBe(buildInvoice(subject, period, updated)?.total)
    const sent = { ...updated, mode: 'real' as const, invoices: updated.invoices.map(row => row.subjectId === subject.id && row.period === period ? { ...row, status: 'sent' as const } : row) }
    expect(reducer(sent, { type: 'uncomplete', unitId: unit.id })).toBe(sent)
    expect(reducer(sent, { type: 'cancelUnit', unitId: unit.id })).toBe(sent)
    expect(reducer(sent, { type: 'addUnit', subjectId: subject.id, date: `${period}-15`, time: '10:00' })).toBe(sent)
  })

  it('keeps unbilled inactive work closable and exposes backlog periods', () => {
    const base = buildScenario('default')
    const subject = base.subjects.find(row => row.billing.mode === 'per_unit')!
    const inactive = reducer(base, { type: 'deactivateSubject', subjectId: subject.id })
    const period = base.units.find(row => row.subjectId === subject.id
      && !base.invoices.some(invoice => invoice.subjectId === subject.id && invoice.period === row.scheduledAt.slice(0, 7)))!
      .scheduledAt.slice(0, 7)
    expect(closablePeriods(inactive)).toContain(period)
    expect(reducer(inactive, { type: 'closeMonth', period }).invoices.some(row => row.subjectId === subject.id && row.period === period)).toBe(true)
  })

  it('protects completed history on delete and supports reactivation', () => {
    const base = buildScenario('default')
    const subject = base.subjects.find(row => base.units.some(unit => unit.subjectId === row.id && base.completions.some(c => c.unitId === unit.id)))!
    const archived = reducer(base, { type: 'deleteSubject', subjectId: subject.id })
    expect(archived.subjects.find(row => row.id === subject.id)?.active).toBe(false)
    const active = reducer(archived, { type: 'reactivateSubject', subjectId: subject.id })
    expect(active.subjects.find(row => row.id === subject.id)?.active).toBe(true)
  })

  it('clears all teacher identity and ledger rows after confirmed server account deletion', () => {
    const seeded = buildScenario('default')
    const base = { ...seeded, mode: 'real' as const, messages: seeded.messages.map((message, index) => index === 0
      ? { ...message, oaDelivery: { providerId: 'provider', workspaceId: 'workspace', recipientId: 'recipient', dedupeKey: 'key', body: message.draft } }
      : message) }
    const cleared = reducer(base, { type: 'deleteAccountLocal' })
    expect(cleared).toMatchObject({ mode: 'real', scenarioId: 'real', onboarded: false })
    expect(cleared.provider).toMatchObject({ name: '', promptpayId: '' })
    expect(cleared.subjects).toEqual([])
    expect(cleared.clients).toEqual([])
    expect(cleared.invoices).toEqual([])
    expect(cleared.events).toEqual([])
  })

  it('rejects unknown chat clients and blank text', () => {
    const state = buildScenario('default')
    expect(reducer(state, { type: 'chat', clientId: 'missing', from: 'client', text: 'hello' })).toBe(state)
    expect(reducer(state, { type: 'chat', clientId: state.clients[0].id, from: 'client', text: '   ' })).toBe(state)
    const blank = { ...state.messages[0], id: 'blank', clientId: state.clients[0].id, draft: ' ', dedupeKey: 'blank' }
    expect(reducer(state, { type: 'addMessage', message: blank })).toBe(state)
  })

  it('creates schedule notices in the same reducer transition', () => {
    const state = buildScenario('default')
    const unit = state.units.find(row => !row.cancelled)!
    const moved = reducer(state, { type: 'rescheduleUnit', unitId: unit.id, date: '2025-10-01', time: '18:30' })
    expect(moved.messages.some(message => message.kind === 'moved' && message.subjectId === unit.subjectId)).toBe(true)
    const cancelled = reducer(state, { type: 'cancelUnit', unitId: unit.id })
    expect(cancelled.messages.some(message => message.kind === 'cancelled' && message.subjectId === unit.subjectId)).toBe(true)
  })
})
