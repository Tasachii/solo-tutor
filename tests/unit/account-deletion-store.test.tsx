import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ACCOUNT_DELETED_KEY, StoreProvider, STORAGE_KEY, useStore,
} from '../../src/core/store'
import { buildScenario } from '../../src/core/scenarios'

afterEach(() => { cleanup(); localStorage.clear() })

describe('account deletion local transaction', () => {
  it('refuses the irreversible preflight in a readonly tab', async () => {
    const original = navigator.locks
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    let store!: ReturnType<typeof useStore>
    function Probe() { store = useStore(); return null }
    try {
      render(<StoreProvider><Probe /></StoreProvider>)
      await waitFor(() => expect(store.writeStatus).toBe('readonly'))
      expect(store.prepareAccountDeletion()).toBe(false)
      expect(localStorage.getItem(ACCOUNT_DELETED_KEY)).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: original })
    }
  })

  it('clears every mounted tab and prevents a follower from resurrecting stale student data', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildScenario('default')))
    const tabs: Record<string, ReturnType<typeof useStore>> = {}
    function Tab({ id }: { id: string }) { tabs[id] = useStore(); return null }
    const leader = render(<StoreProvider><Tab id="leader" /></StoreProvider>)
    await waitFor(() => expect(tabs.leader.writeStatus).toBe('writable'))
    render(<StoreProvider><Tab id="follower" /></StoreProvider>)
    expect(tabs.follower.state.subjects.length).toBeGreaterThan(0)
    expect(tabs.follower.writeStatus).toBe('acquiring')

    let result: ReturnType<typeof tabs.leader.commitAccountDeletion> | undefined
    act(() => {
      expect(tabs.leader.prepareAccountDeletion()).toBe(true)
      expect(tabs.leader.dispatch({ type: 'track', name: 'stale-during-delete' })).toBe(false)
      result = tabs.leader.commitAccountDeletion()
    })

    expect(result).toBe('cleared')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).subjects).toEqual([])
    expect(localStorage.getItem(ACCOUNT_DELETED_KEY)).toBeTruthy()
    await waitFor(() => expect(tabs.follower.state.subjects).toEqual([]))
    leader.unmount()
    await waitFor(() => expect(tabs.follower.writeStatus).toBe('writable'))
    let wrote = false
    act(() => { wrote = tabs.follower.dispatch({ type: 'track', name: 'after-delete' }) })
    expect({ wrote, status: tabs.follower.writeStatus, error: tabs.follower.persistenceError }).toEqual({ wrote: true, status: 'writable', error: null })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).subjects).toEqual([])
  })
})
