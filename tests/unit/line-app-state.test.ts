import { describe, expect, it } from 'vitest'
import { reducer } from '../../src/core/store'
import { buildScenario } from '../../src/core/scenarios'
import { validateState } from '../../src/core/validation'
import type { AppState, Message, OaDelivery } from '../../src/core/types'

const providerId = '10000000-0000-4000-8000-000000000001'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const recipientId = '30000000-0000-4000-8000-000000000001'
function fixture() {
  const state: AppState = { ...buildScenario('default'), mode: 'real', lineWorkspaceId: workspaceId, lineProviderId: providerId }
  const message: Message = { id: 'oa-test', clientId: state.clients[0].id, kind: 'summary', draft: 'เรียนเรียบร้อยแล้ว', status: 'draft', createdAt: state.today, dedupeKey: 'summary:lesson-1' }
  state.messages = [message]
  const delivery: OaDelivery = { providerId, workspaceId, recipientId, dedupeKey: `${workspaceId}:${message.dedupeKey}`, body: message.draft }
  return { state, message, delivery }
}
describe('durable LINE OA intent', () => {
  it('retains and validates an intent across serialization and normalization', () => {
    const { state, message, delivery } = fixture()
    const started = reducer(state, { type: 'oaStart', id: message.id, delivery })
    const loaded = JSON.parse(JSON.stringify(started))
    expect(validateState(loaded).ok).toBe(true)
    expect(reducer(loaded, { type: 'track', name: 'reload' }).messages.find(m => m.id === message.id)?.oaDelivery).toEqual(delivery)
  })
  it('refuses demo sends and a different account', () => {
    const { state, message, delivery } = fixture()
    const demo = { ...state, mode: 'demo' as const }
    expect(reducer(demo, { type: 'oaStart', id: message.id, delivery })).toBe(demo)
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery: { ...delivery, providerId: recipientId } })).toBe(state)
  })
  it('blocks edits, manual acknowledgement, share queue, and deletion while pending', () => {
    const { state, message, delivery } = fixture()
    const started = reducer(state, { type: 'oaStart', id: message.id, delivery })
    expect(reducer(started, { type: 'editMessage', id: message.id, draft: 'changed' })).toBe(started)
    expect(reducer(started, { type: 'skipMessage', id: message.id })).toBe(started)
    expect(reducer(started, { type: 'sendMessage', id: message.id })).toBe(started)
    expect(reducer(started, { type: 'sendingStart', awaiting: message.id, queue: [] })).toBe(started)
    expect(reducer(started, { type: 'clearMessages' }).messages).toContainEqual(expect.objectContaining({ id: message.id, oaDelivery: delivery }))
  })
  it('cannot discard unresolved intent through reset or restore', () => {
    const { state, message, delivery } = fixture()
    const started = reducer(state, { type: 'oaStart', id: message.id, delivery })
    expect(reducer(started, { type: 'restore', state })).toBe(started)
    expect(reducer(started, { type: 'replace', state })).toBe(started)
    expect(reducer(started, { type: 'startReal' })).toBe(started)
  })
  it('settles once for the bound account and records the frozen text', () => {
    const { state, message, delivery } = fixture()
    const started = reducer(state, { type: 'oaStart', id: message.id, delivery })
    expect(reducer(started, { type: 'oaSent', id: message.id, providerId: recipientId })).toBe(started)
    const sent = reducer(started, { type: 'oaSent', id: message.id, providerId })
    expect(sent.messages.find(m => m.id === message.id)).toMatchObject({ status: 'sent', draft: delivery.body, oaDelivery: undefined })
    expect(reducer(sent, { type: 'oaSent', id: message.id, providerId })).toBe(sent)
  })
  it('new ledgers get a new identity; a backup retains its identity', () => {
    const { state } = fixture()
    expect(reducer(state, { type: 'startReal' }).lineWorkspaceId).toBeUndefined()
    expect(reducer(state, { type: 'restore', state }).lineWorkspaceId).toBe(workspaceId)
  })
  it('holds financial changes while a reminder may already be on its way', () => {
    const base: AppState = { ...buildScenario('default'), mode: 'real', lineWorkspaceId: workspaceId, lineProviderId: providerId }
    base.provider = { name: 'QA ครู', promptpayId: '0812345678' }
    const state = reducer(base, { type: 'track', name: 'prepare' })
    const message = state.messages.find(m => m.kind === 'reminder' && m.status === 'draft')!
    expect(message).toBeDefined()
    const delivery: OaDelivery = { providerId, workspaceId, recipientId, dedupeKey: `${workspaceId}:${message.dedupeKey}`, body: message.draft }
    const pending = reducer(state, { type: 'oaStart', id: message.id, delivery })
    expect(pending.messages.find(m => m.id === message.id)?.oaDelivery).toEqual(delivery)
    expect(reducer(pending, { type: 'recordPayment', invoiceId: String(message.meta?.invoiceId), amount: 1, slipVerified: false })).toBe(pending)
    const cancelled = reducer(pending, { type: 'oaCancelled', id: message.id, providerId })
    expect(reducer(cancelled, { type: 'recordPayment', invoiceId: String(message.meta?.invoiceId), amount: 1, slipVerified: false }).payments.length).toBe(state.payments.length + 1)
  })
  it('recovers a prior cloud payload even when the local draft is stale', () => {
    const { state, message, delivery } = fixture()
    state.messages[0] = { ...message, draft: 'local edited version' }
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery })).toBe(state)
    const recovered = reducer(state, { type: 'oaRecover', id: message.id, delivery })
    expect(recovered.messages.find(m => m.id === message.id)?.draft).toBe(delivery.body)
    expect(reducer(recovered, { type: 'oaSent', id: message.id, providerId }).messages.find(m => m.id === message.id)?.status).toBe('sent')
  })
  it('rejects malformed network identities before persistence', () => {
    const { state, message, delivery } = fixture()
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery: { ...delivery, recipientId: '-'.repeat(36) } })).toBe(state)
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery: { ...delivery, dedupeKey: 'wrong' } })).toBe(state)
  })
  it('cannot start another OA delivery while a personal share queue is awaiting confirmation', () => {
    const { state, message, delivery } = fixture()
    state.messages.push({ ...message, id: 'another', dedupeKey: 'another' })
    state.sending = { awaiting: 'another', queue: [message.id] }
    expect(reducer(state, { type: 'oaStart', id: message.id, delivery })).toBe(state)
    state.messages[0].oaDelivery = delivery
    expect(reducer(state, { type: 'oaCancelled', id: message.id, providerId })).toBe(state)
  })
  it('refuses malformed restored delivery markers', () => {
    const { state, message, delivery } = fixture()
    const started = reducer(state, { type: 'oaStart', id: message.id, delivery })
    started.messages[0].oaDelivery!.body = 'tampered payload'
    expect(validateState(started).ok).toBe(false)
  })
})
