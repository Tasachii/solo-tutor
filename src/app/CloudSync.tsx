import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ACCOUNT_DELETED_EVENT, ACCOUNT_DELETED_KEY, SCHEMA, useStore } from '../core/store'
import { getSession, getSupabaseConfig, signOut, SupabaseRestError, type SupabaseSession } from '../integrations/supabaseRest'
import { deleteSnapshot, deleteTeacherAccount, readSnapshot, saveSnapshot } from '../integrations/cloudApi'
import {
  clearAccountLocalArtifacts, decideSync, hasLedgerData, ledgerFingerprint, packSnapshot, readSyncMeta, unpackSnapshot, writeSyncMeta,
  writePrePullBackup, readPrePullBackup, type CloudSnapshot, type SyncDecision,
} from '../core/cloudSync'
import { exportRecoveryKey, forgetKey, forgetKeys, importRecoveryKey, keyFromPassword, loadKey, rememberKey } from '../core/cloudKey'
import { readPlanInfo, writePlanInfo, type PlanInfo } from '../core/plan'
import { readPlan } from '../integrations/planApi'
import { copy } from '../copy'

/**
 * ซิงก์สมุดบัญชีขึ้นคลาวด์อัตโนมัติเมื่อครูเข้าสู่ระบบในโหมดจริง
 * ทุกการตัดสินใจอยู่ใน core/cloudSync (ทดสอบได้) — ที่นี่แค่ต่อสาย: อ่านคลาวด์ → ตัดสิน → push/pull/ถาม
 * ห้ามเดาเมื่อสองฝั่งต่างกัน: ตั้งสถานะ conflict แล้วให้ครูเลือกในหน้าบัญชี
 */
export type SyncStatus = 'off' | 'signedout' | 'locked' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'error'
export type AccountDeleteResult = 'deleted' | 'deleted-local-retained' | 'retention-required' | 'failed'

export interface CloudSyncValue {
  enabled: boolean
  session: SupabaseSession | null
  status: SyncStatus
  lastAt: string | null
  cloud: CloudSnapshot | null
  conflictCounts: { localSubjects: number; cloudSubjects: number } | null
  error: string
  /** แพ็กสมาชิกล่าสุดที่เห็นจากเซิร์ฟเวอร์ — ไม่มีบัญชี = null = ฟรี */
  plan: PlanInfo | null
  refreshPlan: () => Promise<void>
  refreshSession: () => void
  syncNow: () => Promise<void>
  resolve: (choice: 'pull' | 'push') => Promise<boolean>
  unlock: (password: string) => Promise<boolean>
  exportRecovery: () => Promise<string | null>
  importRecovery: (recovery: string) => Promise<boolean>
  /** เวลาของสำเนาที่เก็บไว้ก่อนดึงคลาวด์ครั้งล่าสุด — null = ไม่มี */
  prePullBackupAt: string | null
  /** วางสำเนาก่อนดึงคลาวด์กลับลงเครื่อง แล้วล้าง meta ให้รอบถัดไปถามครูใหม่ ไม่ทับคลาวด์เงียบ ๆ */
  restorePrePullBackup: () => Promise<boolean>
  deleteAccount: (password: string) => Promise<AccountDeleteResult>
  deleteCloud: () => Promise<boolean>
  signOutDevice: () => boolean
}

const Ctx = createContext<CloudSyncValue | null>(null)
const PUSH_DEBOUNCE_MS = 2500
type SyncOperation = { generation: number; userId: string; key: CryptoKey; controller: AbortController }
type AuthOperation = Omit<SyncOperation, 'key'>

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
  const { state, dispatch, hydrated, writeStatus, prepareAccountDeletion, commitAccountDeletion, cancelAccountDeletion } = useStore()
  const enabled = hydrated && state.mode === 'real' && !!getSupabaseConfig()
  const [session, setSession] = useState<SupabaseSession | null>(readSessionSafely)
  const [status, setStatus] = useState<SyncStatus>('off')
  const [lastAt, setLastAt] = useState<string | null>(() => readSyncMeta()?.at ?? null)
  const [cloud, setCloud] = useState<CloudSnapshot | null>(null)
  const [conflictCounts, setConflictCounts] = useState<CloudSyncValue['conflictCounts']>(null)
  const [error, setError] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [plan, setPlan] = useState<PlanInfo | null>(readPlanInfo)
  const [prePullBackupAt, setPrePullBackupAt] = useState<string | null>(() => readPrePullBackup(SCHEMA)?.at ?? null)

  const stateRef = useRef(state); stateRef.current = state
  const sessionRef = useRef(session); sessionRef.current = session
  const keyRef = useRef<CryptoKey | null>(null)
  const statusRef = useRef(status); statusRef.current = status
  const generation = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const busy = useRef<number | null>(null)
  const again = useRef(false)
  const destructive = useRef(false)

  const cancelOperations = useCallback(() => {
    generation.current += 1
    controllers.current.forEach(controller => controller.abort())
    controllers.current.clear()
    busy.current = null
    again.current = false
  }, [])
  const beginAuthOperation = useCallback((): AuthOperation | null => {
    const s = sessionRef.current
    if (!s) return null
    const controller = new AbortController()
    controllers.current.add(controller)
    return { generation: generation.current, userId: s.user.id, controller }
  }, [])
  const beginOperation = useCallback((): SyncOperation | null => {
    const auth = beginAuthOperation(); const key = keyRef.current
    if (!auth || !key) { if (auth) controllers.current.delete(auth.controller); return null }
    return { ...auth, key }
  }, [beginAuthOperation])
  const authOperationIsCurrent = useCallback((op: AuthOperation): boolean =>
    op.generation === generation.current && !op.controller.signal.aborted
      && sessionRef.current?.user.id === op.userId, [])
  const operationIsCurrent = useCallback((op: SyncOperation): boolean =>
    authOperationIsCurrent(op) && keyRef.current === op.key, [authOperationIsCurrent])
  const finishOperation = useCallback((op: AuthOperation) => { controllers.current.delete(op.controller) }, [])
  const identityIsCurrent = useCallback((userId: string, expectedGeneration: number): boolean =>
    expectedGeneration === generation.current && sessionRef.current?.user.id === userId, [])

  const refreshPlan = useCallback(async () => {
    const userId = sessionRef.current?.user.id
    if (!userId) return
    const next = await readPlan()
    if (next && sessionRef.current?.user.id === userId) { writePlanInfo(next); setPlan(next) }
  }, [])

  const fail = useCallback((e: unknown) => {
    if (e instanceof SupabaseRestError && (e.code === 'network' || e.code === 'timeout')) { setStatus('offline'); setError(''); return }
    if (e instanceof SupabaseRestError && (e.code === 'unauthorized' || e.code === 'auth-required')) {
      cancelOperations()
      try { signOut() } catch { /* status below still fails closed */ }
      setSession(null); setStatus('signedout'); setError(e.message); return
    }
    setStatus('error'); setError(e instanceof Error && e.message ? e.message : copy.account.status.error)
  }, [cancelOperations])

  const push = useCallback(async (expected: number, op: SyncOperation): Promise<boolean> => {
    if (!operationIsCurrent(op)) return false
    const st = stateRef.current
    const fingerprint = ledgerFingerprint(st)
    const at = new Date().toISOString()
    const sealed = await packSnapshot(st, op.key, at)
    if (!operationIsCurrent(op) || ledgerFingerprint(stateRef.current) !== fingerprint) { again.current = true; return false }
    const res = await saveSnapshot({ expected, revision: expected + 1, schema: SCHEMA, ...sealed, device: deviceLabel(), signal: op.controller.signal })
    if (!operationIsCurrent(op)) return false
    if (!res.ok) {
      const latest = await readSnapshot(op.controller.signal)
      if (!operationIsCurrent(op)) return false
      let cloudSubjects = 0
      if (latest) {
        const opened = await unpackSnapshot(latest, op.key, SCHEMA)
        if (!operationIsCurrent(op)) return false
        if (opened.ok) cloudSubjects = opened.state.subjects.length
      }
      setCloud(latest); setConflictCounts({ localSubjects: stateRef.current.subjects.length, cloudSubjects }); setStatus('conflict')
      return false
    }
    writeSyncMeta({ providerId: op.userId, cloudRevision: res.revision, localFingerprint: fingerprint, at })
    setLastAt(at); setCloud(null); setConflictCounts(null); setStatus('synced')
    return true
  }, [operationIsCurrent])

  const pull = useCallback(async (head: CloudSnapshot, op: SyncOperation, expectedFingerprint: string): Promise<boolean> => {
    if (!operationIsCurrent(op)) return false
    const r = await unpackSnapshot(head, op.key, SCHEMA)
    if (!operationIsCurrent(op)) return false
    if (!r.ok) {
      if (r.reason === 'locked') { setCloud(head); setStatus('locked'); setError(copy.account.unlockFailed); return false }
      setCloud(head); setStatus('error')
      setError(r.reason === 'unsupportedKdf' ? copy.account.cloudBad.unsupportedKdf : copy.menu.restoreBad[r.reason])
      return false
    }
    if (r.state.mode !== 'real') { setCloud(head); setStatus('error'); setError(copy.account.cloudNotReal); return false }
    // A local edit made while the remote read/decrypt was in flight must never be overwritten.
    if (ledgerFingerprint(stateRef.current) !== expectedFingerprint) {
      setCloud(head)
      setConflictCounts({ localSubjects: stateRef.current.subjects.length, cloudSubjects: r.state.subjects.length })
      setStatus('conflict'); setError('ข้อมูลในเครื่องเปลี่ยนระหว่างดาวน์โหลด กรุณาเลือกอีกครั้ง')
      return false
    }
    const backupAt = new Date().toISOString()
    if (!writePrePullBackup(stateRef.current, backupAt)) {
      setCloud(head); setStatus('error'); setError(copy.account.applyFailed); return false
    }
    setPrePullBackupAt(backupAt)
    if (!dispatch({ type: 'restore', state: r.state })) { setStatus('error'); setError(copy.account.applyFailed); return false }
    // ลายนิ้วมือของก้อนที่เพิ่งวาง — store อาจ normalize เพิ่มร่างข้อความให้ รอบถัดไปก็แค่ push ทับ ไม่ใช่ conflict
    const at = new Date().toISOString()
    writeSyncMeta({ providerId: op.userId, cloudRevision: head.revision, localFingerprint: ledgerFingerprint(r.state), at })
    setLastAt(at); setCloud(null); setConflictCounts(null); setStatus('synced')
    return true
  }, [dispatch, operationIsCurrent])

  const reconcile = useCallback(async (force?: SyncDecision): Promise<boolean> => {
    if (destructive.current || writeStatus !== 'writable') return false
    const op = beginOperation()
    if (!op) return false
    if (busy.current === op.generation) { again.current = true; finishOperation(op); return false }
    busy.current = op.generation
    setStatus('syncing'); setError('')
    try {
      const head = await readSnapshot(op.controller.signal)
      if (!operationIsCurrent(op)) return false
      await refreshPlan()
      if (!operationIsCurrent(op)) return false
      // A matching revision/fingerprint proves no ledger change, not possession
      // of its key. A password reset can leave metadata paired with a new key.
      // Validate the existing ciphertext before reporting synced or replacing it.
      let cloudSubjects = 0
      if (head) {
        const opened = await unpackSnapshot(head, op.key, SCHEMA)
        if (!operationIsCurrent(op)) return false
        if (!opened.ok) {
          setCloud(head)
          if (opened.reason === 'locked') { setStatus('locked'); setError(copy.account.unlockFailed) }
          else { setStatus('error'); setError(opened.reason === 'unsupportedKdf' ? copy.account.cloudBad.unsupportedKdf : copy.account.applyFailed) }
          return false
        }
        if (opened.state.mode !== 'real') { setCloud(head); setStatus('error'); setError(copy.account.cloudNotReal); return false }
        cloudSubjects = opened.state.subjects.length
      }
      // Re-read after every remote await; the user may have edited the ledger while the request was pending.
      const current = stateRef.current
      const fingerprint = ledgerFingerprint(current)
      const decision = force ?? decideSync({ fingerprint, hasData: hasLedgerData(current) }, readSyncMeta(), head, op.userId)
      if (decision === 'push') return await push(head?.revision ?? 0, op)
      if (decision === 'pull') return head ? await pull(head, op, fingerprint) : await push(0, op)
      if (decision === 'conflict') {
        setCloud(head)
        setConflictCounts({ localSubjects: current.subjects.length, cloudSubjects })
        setStatus('conflict')
        return true
      }
      else { setStatus('synced'); setLastAt(readSyncMeta()?.at ?? null) }
      return true
    } catch (e) {
      if (operationIsCurrent(op)) fail(e)
      return false
    } finally {
      finishOperation(op)
      if (busy.current === op.generation) busy.current = null
      if (operationIsCurrent(op) && again.current) { again.current = false; void reconcile() }
    }
  }, [beginOperation, fail, finishOperation, operationIsCurrent, push, pull, refreshPlan, writeStatus])

  // โหลดกุญแจของบัญชีนี้จากเครื่อง — ไม่มี = ต้องขอรหัสผ่านอีกครั้ง (เครื่องใหม่ หรือเคยล้าง)
  useEffect(() => {
    let cancelled = false
    cancelOperations()
    destructive.current = false
    if (!enabled) { keyRef.current = null; setHasKey(false); setStatus('off'); return }
    if (!session) { keyRef.current = null; setHasKey(false); setStatus('signedout'); return }
    const expectedGeneration = generation.current
    void loadKey(session.user.id).then((key) => {
      if (cancelled || expectedGeneration !== generation.current || sessionRef.current?.user.id !== session.user.id) return
      keyRef.current = key; setHasKey(!!key)
      if (!key) setStatus('locked')
    })
    return () => { cancelled = true }
  }, [cancelOperations, enabled, session])

  // ทุกครั้งที่ ledger เปลี่ยน รอให้มือหยุดก่อนแล้วค่อยขึ้นคลาวด์ — ไม่ขัดจังหวะเมื่อครูต้องเลือกอยู่
  useEffect(() => {
    if (!enabled || !session || !hasKey) return
    if (statusRef.current === 'conflict' || statusRef.current === 'locked') return
    const t = window.setTimeout(() => { void reconcile() }, PUSH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [enabled, session, hasKey, state.revision, reconcile, writeStatus])

  // กลับมาออนไลน์หรือกลับมาที่แท็บ = อีกเครื่องอาจแก้ไว้
  useEffect(() => {
    if (!enabled) return
    const wake = () => { if (document.visibilityState === 'visible' && statusRef.current !== 'conflict' && statusRef.current !== 'locked') void reconcile() }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => { window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake) }
  }, [enabled, reconcile])

  const refreshSession = useCallback(() => { setSession(readSessionSafely()) }, [])
  const syncNow = useCallback(async () => { await reconcile() }, [reconcile])
  const resolve = useCallback(async (choice: 'pull' | 'push'): Promise<boolean> => {
    return reconcile(choice)
  }, [reconcile])

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const s = sessionRef.current
    if (!s) return false
    const expectedGeneration = generation.current
    try {
      const key = await keyFromPassword(s.user.id, password)
      if (!identityIsCurrent(s.user.id, expectedGeneration)) return false
      const head = cloud ?? await readSnapshot()
      if (!identityIsCurrent(s.user.id, expectedGeneration)) return false
      if (head) {
        const r = await unpackSnapshot(head, key, SCHEMA)
        if (!r.ok) {
          setError(r.reason === 'unsupportedKdf' ? copy.account.cloudBad.unsupportedKdf : copy.account.unlockFailed)
          return false
        }
      }
      await rememberKey(s.user.id, key)
      if (!identityIsCurrent(s.user.id, expectedGeneration)) { forgetKey(s.user.id); return false }
      cancelOperations()
      keyRef.current = key; setHasKey(true); setError('')
      void reconcile()
      return true
    } catch (e) { fail(e); return false }
  }, [cancelOperations, cloud, fail, identityIsCurrent, reconcile])

  const exportRecovery = useCallback(async (): Promise<string | null> => {
    const s = sessionRef.current; const key = keyRef.current
    if (!s || !key) return null
    const expectedGeneration = generation.current
    try {
      const recovery = await exportRecoveryKey(s.user.id, key)
      return identityIsCurrent(s.user.id, expectedGeneration) && keyRef.current === key ? recovery : null
    } catch (e) { fail(e); return null }
  }, [fail, identityIsCurrent])

  const importRecovery = useCallback(async (recovery: string): Promise<boolean> => {
    const s = sessionRef.current
    if (!s) return false
    const expectedGeneration = generation.current
    try {
      const key = await importRecoveryKey(s.user.id, recovery)
      if (!key || !identityIsCurrent(s.user.id, expectedGeneration)) return false
      const head = await readSnapshot()
      if (!identityIsCurrent(s.user.id, expectedGeneration)) return false
      // ยังไม่มี snapshot = ไม่มีอะไรให้พิสูจน์กุญแจ แต่ไฟล์ตรงบัญชีแล้ว จดไว้แล้ว push ก้อนแรกด้วยกุญแจนี้
      if (head) {
        const opened = await unpackSnapshot(head, key, SCHEMA)
        if (!opened.ok || !identityIsCurrent(s.user.id, expectedGeneration)) return false
      }
      await rememberKey(s.user.id, key)
      if (!identityIsCurrent(s.user.id, expectedGeneration)) { forgetKey(s.user.id); return false }
      cancelOperations()
      keyRef.current = key; setHasKey(true); setError('')
      void reconcile()
      return true
    } catch (e) { fail(e); return false }
  }, [cancelOperations, fail, identityIsCurrent, reconcile])

  const restorePrePullBackup = useCallback(async (): Promise<boolean> => {
    if (writeStatus !== 'writable') return false
    const saved = readPrePullBackup(SCHEMA)
    if (!saved || !saved.result.ok || saved.result.state.mode !== 'real') return false
    cancelOperations()
    if (!dispatch({ type: 'restore', state: saved.result.state })) return false
    // ไม่จดว่าซิงก์แล้ว — รอบถัดไป decideSync เห็นเครื่องมีข้อมูลและไม่มี meta → ถามครูว่าจะเอาชุดไหน
    writeSyncMeta(null); setLastAt(null); setCloud(null); setConflictCounts(null); setError('')
    setStatus('synced')
    return true
  }, [cancelOperations, dispatch, writeStatus])

  const signOutDevice = useCallback((): boolean => {
    const userId = sessionRef.current?.user.id
    cancelOperations()
    destructive.current = false
    try { signOut() } catch { return false }
    if (userId) forgetKey(userId)
    writePlanInfo(null); setPlan(null)
    keyRef.current = null; setHasKey(false); setSession(null); setCloud(null); setConflictCounts(null); setStatus('signedout'); setError('')
    return true
  }, [cancelOperations])

  const purgeDeletedAccount = useCallback((): boolean => {
    cancelOperations()
    destructive.current = true
    let sessionCleared = true
    try { signOut() } catch { sessionCleared = false }
    forgetKeys()
    clearAccountLocalArtifacts()
    writeSyncMeta(null); writePlanInfo(null)
    keyRef.current = null; setHasKey(false); setSession(null); setCloud(null); setConflictCounts(null)
    setLastAt(null); setPlan(null); setStatus('signedout'); setError('')
    return sessionCleared
  }, [cancelOperations])

  useEffect(() => {
    const purge = () => { if (!destructive.current) purgeDeletedAccount() }
    const storage = (event: StorageEvent) => { if (event.key === ACCOUNT_DELETED_KEY && event.newValue) purge() }
    window.addEventListener(ACCOUNT_DELETED_EVENT, purge)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener(ACCOUNT_DELETED_EVENT, purge)
      window.removeEventListener('storage', storage)
    }
  }, [purgeDeletedAccount])

  const deleteCloud = useCallback(async (): Promise<boolean> => {
    destructive.current = true
    cancelOperations()
    const op = beginAuthOperation()
    if (!op) { destructive.current = false; return false }
    try { await deleteSnapshot(op.controller.signal) } catch (e) {
      destructive.current = false
      if (authOperationIsCurrent(op)) fail(e)
      finishOperation(op)
      return false
    }
    finishOperation(op)
    if (!authOperationIsCurrent(op)) { destructive.current = false; return false }
    writeSyncMeta(null); setLastAt(null)
    return signOutDevice()
  }, [authOperationIsCurrent, beginAuthOperation, cancelOperations, fail, finishOperation, signOutDevice])

  const deleteAccount = useCallback(async (password: string): Promise<AccountDeleteResult> => {
    if (!prepareAccountDeletion()) return 'failed'
    destructive.current = true
    cancelOperations()
    const op = beginAuthOperation()
    if (!op) { destructive.current = false; cancelAccountDeletion(); return 'failed' }
    try {
      const deleted = await deleteTeacherAccount(password, op.controller.signal)
      if (!authOperationIsCurrent(op) || !deleted) {
        destructive.current = false; cancelAccountDeletion(); return 'failed'
      }
      const local = commitAccountDeletion()
      const credentialsCleared = purgeDeletedAccount()
      return local === 'cleared' && credentialsCleared ? 'deleted' : 'deleted-local-retained'
    } catch (e) {
      cancelAccountDeletion()
      if (authOperationIsCurrent(op) && e instanceof SupabaseRestError && e.code === 'retention-required') {
        destructive.current = false
        setError(e.message)
        return 'retention-required'
      }
      destructive.current = false
      if (authOperationIsCurrent(op)) fail(e)
      return 'failed'
    } finally {
      finishOperation(op)
    }
  }, [authOperationIsCurrent, beginAuthOperation, cancelAccountDeletion, cancelOperations, commitAccountDeletion,
    fail, finishOperation, prepareAccountDeletion, purgeDeletedAccount])

  const value = useMemo<CloudSyncValue>(() => ({
    enabled, session, status, lastAt, cloud, conflictCounts, error, plan, refreshPlan, refreshSession, syncNow, resolve, unlock,
    exportRecovery, importRecovery, prePullBackupAt, restorePrePullBackup, deleteAccount, deleteCloud, signOutDevice,
  }), [enabled, session, status, lastAt, cloud, conflictCounts, error, plan, refreshPlan, refreshSession, syncNow, resolve, unlock,
    exportRecovery, importRecovery, prePullBackupAt, restorePrePullBackup, deleteAccount, deleteCloud, signOutDevice])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const OFF: CloudSyncValue = {
  enabled: false, session: null, status: 'off', lastAt: null, cloud: null, conflictCounts: null, error: '', plan: null, refreshPlan: async () => {},
  refreshSession: () => {}, syncNow: async () => {}, resolve: async () => false, unlock: async () => false,
  exportRecovery: async () => null, importRecovery: async () => false, prePullBackupAt: null, restorePrePullBackup: async () => false,
  deleteAccount: async () => 'failed',
  deleteCloud: async () => false, signOutDevice: () => { try { signOut() } catch { return false } forgetKeys(); return true },
}
/** นอก provider (เช่นเทสหน้าเดี่ยว) ได้ค่าปิดไว้ — ไม่โยน เพื่อให้หน้าเชื่อม LINE ยังเรนเดอร์ได้ */
export const useCloudSync = (): CloudSyncValue => useContext(Ctx) ?? OFF
