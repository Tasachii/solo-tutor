import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { DEMO_SLOT_KEY as STORAGE_KEY, StoreProvider, useStore } from '../../src/core/store'
import { buildScenario } from '../../src/core/scenarios'

let store: ReturnType<typeof useStore>
function Probe() { store = useStore(); return null }
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); history.replaceState({}, '', '/') })
const mount = () => render(<StoreProvider><Probe /></StoreProvider>)
describe('durable local transitions', () => {
  it('persists a critical queue before dispatch returns', () => {
    mount()
    const id = store.state.messages[0].id
    act(() => { store.dispatch({ type: 'sendingStart', awaiting: id, queue: [] }) })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sending.awaiting).toBe(id)
  })
  it('does not commit a payment when storage throws', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('default')))
    mount()
    const before = store.state.payments.length
    const inv = store.state.invoices.find(i => i.status === 'overdue')!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    let ok: unknown
    act(() => { ok = store.dispatch({ type: 'recordPayment', invoiceId: inv.id, amount: 100, slipVerified: false }) })
    expect(ok).toBe(false)
    expect(store.state.payments).toHaveLength(before)
    expect(store.persistenceError).toBeTruthy()
  })
  it('does not mutate an existing payer when an onboarding write fails', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('default')))
    mount()
    const payer = store.state.clients[0]
    const originalName = payer.name
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    let ok: unknown
    act(() => { ok = store.dispatch({
      type: 'finishOnboarding', provider: store.state.provider,
      rows: [{ name: 'คนใหม่', clientName: 'ชื่อใหม่', clientId: payer.id }],
      billing: { mode: 'per_unit', rate: 500 },
    }) })
    expect(ok).toBe(false)
    expect(store.state.clients.find(client => client.id === payer.id)?.name).toBe(originalName)
  })
  it('preserves broken raw JSON and blocks ordinary autosave', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    mount()
    act(() => { store.dispatch({ type: 'track', name: 'app_open' }) })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
    expect(store.recoveryRaw).toBe('{broken')
  })
  it('keeps the previous workspace when restoring a backup', () => {
    mount()
    const before = localStorage.getItem(STORAGE_KEY)
    act(() => { store.dispatch({ type: 'restore', state: buildScenario('empty') }) })
    expect(localStorage.getItem(`${STORAGE_KEY}-before-restore`)).toBe(before)
    expect(store.state.subjects).toHaveLength(0)
  })
})

describe('exclusive writer leadership', () => {
  it('honors an explicit demo scenario when the first lock sees unchanged storage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('default')))
    history.replaceState({}, '', '/?scenario=package-heavy')
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    expect(store.state.scenarioId).toBe('package-heavy')
    expect(store.state.subjects.some(subject => subject.id === 'p1')).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).scenarioId).toBe('package-heavy')
  })

  it('does not apply a waiting follower scenario after the writer commits newer data', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('default')))
    const tabs: Record<string, ReturnType<typeof useStore>> = {}
    function Tab({ id }: { id: string }) { tabs[id] = useStore(); return null }
    const first = render(<StoreProvider><Tab id="first" /></StoreProvider>)
    await waitFor(() => expect(tabs.first.writeStatus).toBe('writable'))

    history.replaceState({}, '', '/?scenario=package-heavy')
    render(<StoreProvider><Tab id="second" /></StoreProvider>)
    expect(tabs.second.writeStatus).toBe('acquiring')
    act(() => { expect(tabs.first.dispatch({ type: 'track', name: 'newer-writer-data' })).toBe(true) })
    first.unmount()

    await waitFor(() => expect(tabs.second.writeStatus).toBe('writable'))
    expect(tabs.second.state.scenarioId).toBe('default')
    expect(tabs.second.state.events.some(event => event.name === 'newer-writer-data')).toBe(true)
  })

  it('keeps the second tab read-only until the lifetime lock is released', async () => {
    const tabs: Record<string, ReturnType<typeof useStore>> = {}
    function Tab({ id }: { id: string }) { tabs[id] = useStore(); return null }
    const first = render(<StoreProvider><Tab id="first" /></StoreProvider>)
    await waitFor(() => expect(tabs.first.writeStatus).toBe('writable'))
    render(<StoreProvider><Tab id="second" /></StoreProvider>)
    expect(tabs.second.writeStatus).toBe('acquiring')
    expect(tabs.second.dispatch({ type: 'track', name: 'follower-write' })).toBe(false)
    first.unmount()
    await waitFor(() => expect(tabs.second.writeStatus).toBe('writable'))
  })

  it('refuses a stale commit and can retry from the latest durable revision', async () => {
    mount()
    await waitFor(() => expect(store.writeStatus).toBe('writable'))
    const durable = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...durable, revision: durable.revision + 1 }))
    let committed: boolean | undefined
    act(() => { committed = store.dispatch({ type: 'track', name: 'stale-write' }) })
    expect(committed).toBe(false)
    expect(store.writeStatus).toBe('conflict')
    let retried: boolean | undefined
    act(() => { retried = store.retryPersistence() })
    expect(retried).toBe(true)
    expect(store.writeStatus).toBe('writable')
    expect(store.state.revision).toBeGreaterThanOrEqual(durable.revision + 1)
    expect(store.state.revision).toBe(JSON.parse(localStorage.getItem(STORAGE_KEY)!).revision)
  })

  it('fails closed when Web Locks is unsupported', async () => {
    const original = navigator.locks
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    try {
      mount()
      await waitFor(() => expect(store.writeStatus).toBe('readonly'))
      expect(store.dispatch({ type: 'track', name: 'must-not-write' })).toBe(false)
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: original })
    }
  })
})
