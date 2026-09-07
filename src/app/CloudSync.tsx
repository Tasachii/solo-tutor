import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SCHEMA, useStore } from '../core/store'
import { getSession, getSupabaseConfig, signOut, SupabaseRestError, type SupabaseSession } from '../integrations/supabaseRest'
import { deleteSnapshot, readSnapshot, saveSnapshot } from '../integrations/cloudApi'
import {
  decideSync, hasLedgerData, packSnapshot, readSyncMeta, unpackSnapshot, writeSyncMeta,
  type CloudSnapshot, type SyncDecision,
} from '../core/cloudSync'
import { forgetKeys, loadKey, rememberKeyFromPassword } from '../core/cloudKey'
import { readPlanInfo, writePlanInfo, type PlanInfo } from '../core/plan'
import { readPlan } from '../integrations/planApi'
import { copy } from '../copy'

/**
 * ซิงก์สมุดบัญชีขึ้นคลาวด์อัตโนมัติเมื่อครูเข้าสู่ระบบในโหมดจริง
 * ทุกการตัดสินใจอยู่ใน core/cloudSync (ทดสอบได้) — ที่นี่แค่ต่อสาย: อ่านคลาวด์ → ตัดสิน → push/pull/ถาม
 * ห้ามเดาเมื่อสองฝั่งต่างกัน: ตั้งสถานะ conflict แล้วให้ครูเลือกในหน้าบัญชี
 */
export type SyncStatus = 'off' | 'signedout' | 'locked' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'error'

export interface CloudSyncValue {
  enabled: boolean
  session: SupabaseSession | null
  status: SyncStatus
  lastAt: string | null
  cloud: CloudSnapshot | null
  error: string
  /** แพ็กสมาชิกล่าสุดที่เห็นจากเซิร์ฟเวอร์ — ไม่มีบัญชี = null = ฟรี */
  plan: PlanInfo | null
  refreshPlan: () => Promise<void>
  refreshSession: () => void
  syncNow: () => Promise<void>
  resolve: (choice: 'pull' | 'push') => Promise<boolean>
  unlock: (password: string) => Promise<boolean>
  deleteCloud: () => Promise<boolean>
  signOutDevice: () => boolean
}

const Ctx = createContext<CloudSyncValue | null>(null)
const PUSH_DEBOUNCE_MS = 2500

const readSessionSafely = (): SupabaseSession | null => { try { return getSession() } catch { return null } }
const deviceLabel = (): string => {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return 'web'
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { state, dispatch, hydrated } = useStore()
  const enabled = hydrated && state.mode === 'real' && !!getSupabaseConfig()
  const [session, setSession] = useState<SupabaseSession | null>(readSessionSafely)
  const [status, setStatus] = useState<SyncStatus>('off')
  const [lastAt, setLastAt] = useState<string | null>(() => readSyncMeta()?.at ?? null)
  const [cloud, setCloud] = useState<CloudSnapshot | null>(null)
  const [error, setError] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [plan, setPlan] = useState<PlanInfo | null>(readPlanInfo)

  const stateRef = useRef(state); stateRef.current = state
  const sessionRef = useRef(session); sessionRef.current = session
  const keyRef = useRef<CryptoKey | null>(null)
  const statusRef = useRef(status); statusRef.current = status
  const busy = useRef(false)
  const again = useRef(false)

  const refreshPlan = useCallback(async () => {
    if (!sessionRef.current) return
    const next = await readPlan()
    if (next) { writePlanInfo(next); setPlan(next) }
  }, [])

  const fail = useCallback((e: unknown) => {
    if (e instanceof SupabaseRestError && (e.code === 'network' || e.code === 'timeout')) { setStatus('offline'); setError(''); return }
    if (e instanceof SupabaseRestError && (e.code === 'unauthorized' || e.code === 'auth-required')) {
      setSession(null); setStatus('signedout'); setError(e.message); return
    }
    setStatus('error'); setError(e instanceof Error && e.message ? e.message : copy.account.status.error)
  }, [])

  const push = useCallback(async (expected: number) => {
    const key = keyRef.current; const s = sessionRef.current; const st = stateRef.current
    if (!key || !s) return
    const at = new Date().toISOString()
    const sealed = await packSnapshot(st, key, at)
    const res = await saveSnapshot({ expected, revision: expected + 1, schema: SCHEMA, ...sealed, device: deviceLabel() })
    if (!res.ok) { setCloud(await readSnapshot()); setStatus('conflict'); return }
    writeSyncMeta({ providerId: s.user.id, cloudRevision: res.revision, localRevision: st.revision, at })
    setLastAt(at); setCloud(null); setStatus('synced')
  }, [])

  const pull = useCallback(async (head: CloudSnapshot) => {
    const key = keyRef.current; const s = sessionRef.current
    if (!key || !s) return
    const r = await unpackSnapshot(head, key, SCHEMA)
    if (!r.ok) {
      if (r.reason === 'locked') { setCloud(head); setStatus('locked'); setError(copy.account.unlockFailed); return }
      setCloud(head); setStatus('error'); setError(copy.menu.restoreBad[r.reason]); return
    }
    if (r.state.mode !== 'real') { setCloud(head); setStatus('error'); setError(copy.account.cloudNotReal); return }
    const before = stateRef.current.revision
    if (!dispatch({ type: 'restore', state: r.state })) { setStatus('error'); setError(copy.account.applyFailed); return }
    // commit ของ store ตั้ง revision = ของเดิม + 1 เสมอ (ดู dispatch ใน core/store) — จดไว้ว่ารอบนี้เท่ากับคลาวด์แล้ว
    const at = new Date().toISOString()
    writeSyncMeta({ providerId: s.user.id, cloudRevision: head.revision, localRevision: before + 1, at })
    setLastAt(at); setCloud(null); setStatus('synced')
  }, [dispatch])

  const reconcile = useCallback(async (force?: SyncDecision) => {
    const s = sessionRef.current; const st = stateRef.current
    if (!s || !keyRef.current) return
    if (busy.current) { again.current = true; return }
    busy.current = true
    setStatus('syncing'); setError('')
    try {
      const head = await readSnapshot()
      await refreshPlan()
      const decision = force ?? decideSync({ revision: st.revision, hasData: hasLedgerData(st) }, readSyncMeta(), head, s.user.id)
      if (decision === 'push') await push(head?.revision ?? 0)
      else if (decision === 'pull') { if (head) await pull(head); else await push(0) }
      else if (decision === 'conflict') { setCloud(head); setStatus('conflict') }
      else { setStatus('synced'); setLastAt(readSyncMeta()?.at ?? null) }
    } catch (e) {
      fail(e)
    } finally {
      busy.current = false
      if (again.current) { again.current = false; void reconcile() }
    }
  }, [fail, push, pull, refreshPlan])

  // โหลดกุญแจของบัญชีนี้จากเครื่อง — ไม่มี = ต้องขอรหัสผ่านอีกครั้ง (เครื่องใหม่ หรือเคยล้าง)
  useEffect(() => {
    let cancelled = false
    if (!enabled) { setStatus('off'); return }
    if (!session) { keyRef.current = null; setHasKey(false); setStatus('signedout'); return }
    void loadKey(session.user.id).then((key) => {
      if (cancelled) return
      keyRef.current = key; setHasKey(!!key)
      if (!key) setStatus('locked')
    })
    return () => { cancelled = true }
  }, [enabled, session])

  // ทุกครั้งที่ ledger เปลี่ยน รอให้มือหยุดก่อนแล้วค่อยขึ้นคลาวด์ — ไม่ขัดจังหวะเมื่อครูต้องเลือกอยู่
  useEffect(() => {
    if (!enabled || !session || !hasKey) return
    if (statusRef.current === 'conflict' || statusRef.current === 'locked') return
    const t = window.setTimeout(() => { void reconcile() }, PUSH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [enabled, session, hasKey, state.revision, reconcile])

  // กลับมาออนไลน์หรือกลับมาที่แท็บ = อีกเครื่องอาจแก้ไว้
  useEffect(() => {
    if (!enabled) return
    const wake = () => { if (document.visibilityState === 'visible' && statusRef.current !== 'conflict' && statusRef.current !== 'locked') void reconcile() }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => { window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake) }
  }, [enabled, reconcile])

  const refreshSession = useCallback(() => { setSession(readSessionSafely()) }, [])
  const syncNow = useCallback(() => reconcile(), [reconcile])
  const resolve = useCallback(async (choice: 'pull' | 'push'): Promise<boolean> => {
    try {
      const head = await readSnapshot()
      if (choice === 'pull') { if (!head) { await push(0) } else await pull(head) }
      else await push(head?.revision ?? 0)
      return statusRef.current !== 'error'
    } catch (e) { fail(e); return false }
  }, [fail, pull, push])

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const s = sessionRef.current
    if (!s) return false
    try {
      const key = await rememberKeyFromPassword(s.user.id, password)
      const head = cloud ?? await readSnapshot()
      if (head) {
        const r = await unpackSnapshot(head, key, SCHEMA)
        if (!r.ok && r.reason === 'locked') { forgetKeys(); setError(copy.account.unlockFailed); return false }
      }
      keyRef.current = key; setHasKey(true); setError('')
      void reconcile()
      return true
    } catch (e) { fail(e); return false }
  }, [cloud, fail, reconcile])

  const signOutDevice = useCallback((): boolean => {
    try { signOut() } catch { return false }
    forgetKeys(); writePlanInfo(null); setPlan(null)
    keyRef.current = null; setHasKey(false); setSession(null); setCloud(null); setStatus('signedout'); setError('')
    return true
  }, [])

  const deleteCloud = useCallback(async (): Promise<boolean> => {
    try { await deleteSnapshot() } catch (e) { fail(e); return false }
    writeSyncMeta(null); setLastAt(null)
    return signOutDevice()
  }, [fail, signOutDevice])

  const value = useMemo<CloudSyncValue>(() => ({
    enabled, session, status, lastAt, cloud, error, plan, refreshPlan, refreshSession, syncNow, resolve, unlock, deleteCloud, signOutDevice,
  }), [enabled, session, status, lastAt, cloud, error, plan, refreshPlan, refreshSession, syncNow, resolve, unlock, deleteCloud, signOutDevice])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const OFF: CloudSyncValue = {
  enabled: false, session: null, status: 'off', lastAt: null, cloud: null, error: '', plan: null, refreshPlan: async () => {},
  refreshSession: () => {}, syncNow: async () => {}, resolve: async () => false, unlock: async () => false,
  deleteCloud: async () => false, signOutDevice: () => { try { signOut() } catch { return false } forgetKeys(); return true },
}
/** นอก provider (เช่นเทสหน้าเดี่ยว) ได้ค่าปิดไว้ — ไม่โยน เพื่อให้หน้าเชื่อม LINE ยังเรนเดอร์ได้ */
export const useCloudSync = (): CloudSyncValue => useContext(Ctx) ?? OFF
