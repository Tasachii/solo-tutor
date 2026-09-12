import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../core/store'
import { getSession, rpc, type SupabaseSession } from '../integrations/supabaseRest'
import { deliveryTarget, eraseClients, readChannel, syncClients, type LineChannel } from '../integrations/lineApi'
import { erasableClientKeys } from '../core/tombstones'
import { lineAddFriendUrl, lineInviteMessage } from '../core/lineInvite'
import { copyText } from './share'
import { oaAvailable } from './oaSend'
import { lineLinkCopy } from './lineLinkCopy'

/**
 * สถานะการเชื่อม LINE OA ต่อผู้จ่ายหนึ่งคน และการเชิญผู้ปกครอง — ทางเดียวของทั้งแอป
 *
 * ทำไมแคชต้องอยู่ระดับโมดูล ไม่ใช่ใน component: หน้าแอดมินหน้าเดียวมีการ์ดข้อความได้สิบใบ
 * ถ้าแต่ละใบถามเซิร์ฟเวอร์เอง ครูจะยิง RPC สิบครั้งเพื่อคำตอบเดียวกัน และปุ่มแต่ละใบจะขึ้นไม่พร้อมกัน
 * แคชนี้เก็บผลต่อ (workspace, ผู้จ่าย) แล้วปลุกทุกการ์ดที่ยังอยู่บนจอพร้อมกัน
 *
 * token ต่อคีย์กันคำตอบเก่าทับคำตอบใหม่: ครูกด "ตรวจสถานะ" ระหว่างที่คำขอเดิมยังค้าง
 * คำตอบเก่าของ*คีย์นั้น*ต้องถูกทิ้ง ส่วนคำขอของผู้จ่ายคนอื่นที่ยังวิ่งอยู่ต้องไม่ถูกลอยแพ
 * (ถ้าทิ้งทั้งกระดาน การ์ดใบอื่นจะค้างที่ "ยังไม่รู้" ตลอดไป เพราะ effect ไม่ได้ถูกเรียกใหม่)
 */
export type LinkStatus = 'linked' | 'unlinked' | 'unknown'
type Entry = {
  /** ผู้ปกครองพิมพ์รหัสแล้วและยังไม่บล็อก OA — ความหมายเดียวกับที่หน้าตั้งค่าเคยใช้ */
  paired: boolean
  /** ส่งได้จริงตอนนี้ไหม (รวมสถานะช่องและโควตา) — เก็บไว้ให้รอบหน้าที่จะรวมกับ linkStates */
  eligible: boolean
}

const listeners = new Set<() => void>()
const notify = (): void => { for (const listener of [...listeners]) listener() }

let owner: string | null = null
/**
 * เพิ่มขึ้นทุกครั้งที่แคชถูกทิ้งทั้งก้อน — อยู่ใน deps ของ effect ทุกตัว
 * ไม่งั้นการ์ดใบอื่นที่ยัง mount อยู่จะไม่มีวันถามใหม่ (deps ไม่เปลี่ยน) แล้วค้างที่ "ยังไม่รู้" ตลอด
 * เกิดจริงเมื่อ CloudSync ออกจากระบบเบื้องหลังระหว่างที่ครูเปิดหน้าแอดมินค้างไว้
 */
let generation = 0
/** เลขประจำคำขอ — คำตอบที่กลับมาพร้อม token ที่ถูกยกเลิกไปแล้ว จะไม่ถูกเขียนลงแคช */
let ticket = 0
const targets = new Map<string, Entry>()
const pending = new Map<string, number>()
/**
 * คำขอที่กำลังวิ่งของแต่ละคีย์ — เก็บไว้ให้ `refresh` ที่มาทีหลัง "เกาะไปด้วย" แทนที่จะยิงซ้ำ
 * ไม่งั้นหน้าตั้งค่าที่เปิดมาแล้วสั่งตรวจใหม่ทันที จะยิง `line_delivery_target` สองเท่าของจำนวนผู้จ่าย
 * แล้วทิ้งคำตอบชุดแรกทั้งชุด — ครูที่มีผู้ปกครองยี่สิบคนจ่ายค่านั้นบนเน็ตงานประชุม
 */
const inflight = new Map<string, Promise<void>>()
let channelRow: LineChannel | null = null
let channelLoaded = false
let channelTicket = 0
let channelInFlight = false

const targetKey = (workspace: string, clientId: string): string => `${workspace}:${clientId}`

/**
 * ยกเลิกความเป็นเจ้าของคำขอที่ยังค้างของคีย์เหล่านี้ — คำตอบที่กลับมาทีหลังจะถูกทิ้ง
 * ไม่ลบผลเดิมทิ้ง: ระหว่างถามใหม่ ครูต้องเห็นคำตอบเก่าไปก่อน ไม่ใช่เห็นปุ่มหายไปแล้วโผล่กลับมา
 */
const supersede = (keys: string[]): void => {
  for (const key of keys) { pending.delete(key); inflight.delete(key) }
}

const dropCache = (): void => {
  generation += 1
  targets.clear(); pending.clear(); inflight.clear()
  channelRow = null; channelLoaded = false; channelInFlight = false
  channelTicket += 1
}

/** บัญชีครูเปลี่ยน = ข้อมูลของบัญชีเดิมใช้ต่อไม่ได้เลย ทั้งช่อง OA และการจับคู่ */
const claimOwner = (userId: string | null): boolean => {
  if (owner === userId) return false
  owner = userId
  dropCache()
  return true
}

/** สำหรับเทสเท่านั้น — แคชระดับโมดูลข้ามไฟล์เทสได้ถ้าไม่ล้าง */
export const __resetLineLinkCache = (): void => { owner = null; dropCache(); notify() }

const readSessionSafely = (): SupabaseSession | null => { try { return getSession() } catch { return null } }

const loadChannel = async (): Promise<void> => {
  if (channelInFlight) return
  channelInFlight = true
  const mine = channelTicket
  try {
    const next = await readChannel()
    if (mine !== channelTicket) return
    channelRow = next
    // ทำเครื่องหมายว่า "รู้แล้ว" เฉพาะตอนอ่านสำเร็จ
    channelLoaded = true
  } catch {
    // อ่านไม่ได้ = ยังไม่รู้ ไม่ใช่ "ไม่มีช่อง" — ถ้าปักว่ารู้แล้ว เน็ตสะดุดครั้งเดียว
    // ปุ่มเชิญจะกลายเป็นลิงก์ "ตั้งค่า LINE OA" ไปทั้งเซสชันโดยไม่มีทางถามใหม่
  } finally {
    if (mine === channelTicket) { channelInFlight = false; notify() }
  }
}

const loadTargets = async (workspace: string, clientIds: string[], force = false): Promise<void> => {
  const wanted = force ? clientIds : clientIds.filter(id => {
    const key = targetKey(workspace, id)
    return !targets.has(key) && !pending.has(key)
  })
  if (!wanted.length) return
  for (const id of wanted) pending.set(targetKey(workspace, id), ++ticket)
  // ถามพร้อมกันทีเดียว ไม่ใช่ทีละใบตามลำดับ — ครูเปิดหน้าแล้วปุ่มต้องขึ้นพร้อมกัน
  const runs = wanted.map(async id => {
    const key = targetKey(workspace, id)
    const mine = pending.get(key)
    try {
      const target = await deliveryTarget(workspace, id)
      if (pending.get(key) !== mine) return
      targets.set(key, { paired: !!target?.recipient_id && !target.unfollowed_at, eligible: !!target?.eligible })
    } catch {
      // ไม่รู้ผล = ไม่ตัดสิน ครูกด "ตรวจสถานะ" ใหม่ได้
    } finally {
      if (pending.get(key) === mine) { pending.delete(key); inflight.delete(key) }
    }
  })
  // ลงทะเบียนหลังตัวคำขอเริ่มวิ่งแล้ว แต่ยังอยู่ในบล็อกซิงโครนัสเดียวกัน — `finally` เป็น microtask จึงมาทีหลังเสมอ
  wanted.forEach((id, index) => inflight.set(targetKey(workspace, id), runs[index]))
  await Promise.all(runs)
  notify()
}

export interface LineLinkCode { code: string; expires_at: string }

export function useLineLink(clientIds: string[] = []) {
  const { state, dispatch } = useStore()
  const [, bump] = useState(0)
  const [session, setSession] = useState(readSessionSafely)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [codes, setCodes] = useState<Record<string, LineLinkCode>>({})
  const working = useRef(false)

  const cacheGeneration = generation
  const workspace = state.lineWorkspaceId
  const mismatch = !!session && !!state.lineProviderId && state.lineProviderId !== session.user.id
  /** OA มีความหมายเฉพาะโหมดจริงที่ผูกโปรเจกต์แล้ว + เข้าสู่ระบบด้วยบัญชีที่เป็นเจ้าของสมุดนี้ */
  const live = oaAvailable(state) && !!session && !mismatch
  const ids = [...new Set(clientIds)].filter(Boolean).sort()
  const idsKey = ids.join(',')

  useEffect(() => {
    const listener = () => bump(n => n + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  useEffect(() => {
    // ที่เก็บ session คือความจริงเดียว — instance ที่ถือของเก่าอยู่ต้องตามให้ทัน ไม่ใช่แย่งกันตั้ง owner
    const current = readSessionSafely()
    if ((current?.user.id ?? null) !== (session?.user.id ?? null)) { setSession(current); return }
    if (!live) {
      // ออกจากระบบแล้วต้องไม่เหลือสถานะของบัญชีเดิมค้างบนจอ
      if (claimOwner(null)) notify()
      return
    }
    if (claimOwner(session!.user.id)) notify()
    if (!channelLoaded) void loadChannel()
    if (workspace && idsKey) void loadTargets(workspace, idsKey.split(','))
    // ถามใหม่เมื่อบัญชี/สมุด/รายชื่อที่การ์ดนี้สนใจเปลี่ยน หรือแคชถูกทิ้งทั้งก้อน
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, session?.user.id, workspace, idsKey, cacheGeneration])

  const status = (clientId: string): LinkStatus => {
    if (!live) return 'unknown'
    // ยังไม่มีสมุด LINE = ยังไม่มีใครจับคู่ได้เลย ปุ่มเชิญจึงต้องขึ้น (การเชิญเป็นคนสร้างสมุดให้)
    if (!workspace) return 'unlinked'
    const entry = targets.get(targetKey(workspace, clientId))
    return entry ? (entry.paired ? 'linked' : 'unlinked') : 'unknown'
  }

  /**
   * ผู้จ่ายที่ครูลบไปแล้วต้องหายจากเซิร์ฟเวอร์ด้วย ไม่ใช่หายแค่ในเครื่อง
   * ขับเคลื่อนจากรายการที่ครูลบจริงเท่านั้น — แถวที่หายไปจากสมุดของเครื่องที่ข้อมูลเก่ากว่า ไม่ใช่การลบ
   * เรียกซ้ำได้ ฝั่งเซิร์ฟเวอร์ทำงานเดิมซ้ำแล้วผลเท่าเดิม
   */
  const flushErasures = async (id = workspace): Promise<void> => {
    if (!id) return
    const keys = erasableClientKeys(state)
    if (keys.length) await eraseClients(id, keys)
  }

  /**
   * `joinInFlight` = "ฉันแค่เปิดหน้ามา ยังไม่มีคำถามใหม่" — เกาะคำขอที่กำลังวิ่งอยู่แทนการยิงซ้ำทั้งชุด
   * ใช้ที่เดียวคือ effect ตอนเปิดหน้าตั้งค่า ซึ่งคำขอที่ค้างอยู่เก่าที่สุดก็แค่เท่าอายุการเปิดหน้า
   *
   * ทุกครั้งที่ **ครูกดปุ่มเอง** ต้องยิงใหม่เสมอ (ค่าเริ่มต้น) — การกดคือคำถามใหม่ที่มีเวลาของตัวเอง
   * เดาจากตั๋วของ render ไม่ได้: เชิญผู้ปกครองสำเร็จ → `workspace` เปลี่ยน → effect ยิงคำขอชุดใหม่
   * ครูกด "ตรวจสถานะ" ตอนนั้นพอดี จะได้คำตอบที่ยิงไปตั้งแต่ก่อนผู้ปกครองพิมพ์รหัส แล้วขึ้นว่ายังไม่เชื่อม
   */
  const refresh = async (only?: string[], { joinInFlight = false }: { joinInFlight?: boolean } = {}): Promise<void> => {
    if (!live) return
    setBusy(true); setNotice('')
    // ตรวจให้ผู้จ่ายคนเดียว (ปุ่มบนการ์ด) ต้องตอบให้ได้ว่าผลเปลี่ยนไหม ไม่ใช่เงียบเหมือนปุ่มเสีย
    const one = only?.length === 1 && workspace ? targetKey(workspace, only[0]) : ''
    const was = one ? targets.get(one) : undefined
    try {
      // ถามใหม่โดยยังโชว์คำตอบเก่าไว้ก่อน — ถ้าล้างค่าทิ้งระหว่างรอ ปุ่มที่ครูเพิ่งกดจะหายไปใต้นิ้ว
      // ยกเลิกเฉพาะความเป็นเจ้าของคำขอของคีย์ที่จะถามใหม่ ของการ์ดใบอื่นที่กำลังโหลดอยู่ไม่ถูกแตะ
      //
      // แยกคีย์ให้เสร็จ**ก่อน await ตัวแรก**: หลัง await คำขอของ effect อาจจบไปแล้ว
      // แล้วจะแยกไม่ออกว่า "ไม่มีคำขอค้าง" เพราะยังไม่เคยถาม หรือเพราะเพิ่งถามไปเมื่อกี้
      const asked = only ?? ids
      const joining: Promise<void>[] = []
      const refetch: string[] = []
      if (workspace) for (const id of asked) {
        const key = targetKey(workspace, id)
        const run = inflight.get(key)
        // `pending` คือความเป็นเจ้าของ — มีทั้งคู่เท่านั้นจึงแปลว่ามีคำขอที่ยังวิ่งและยังไม่ถูกยกเลิก
        if (joinInFlight && run && pending.has(key)) { joining.push(run); continue }
        supersede([key])
        refetch.push(id)
      }
      channelInFlight = false; channelTicket += 1
      await loadChannel()
      await flushErasures()
      if (workspace && refetch.length) await loadTargets(workspace, refetch, true)
      if (joining.length) await Promise.all(joining)
      if (one) {
        // ผลใหม่เป็นวัตถุคนละใบเสมอ — เท่าเดิมแปลว่าถามไม่สำเร็จ ไม่ใช่ "ยังไม่ผูก"
        const now = targets.get(one)
        setNotice(now === was ? lineLinkCopy.failed
          : now?.paired ? lineLinkCopy.linkedNow : lineLinkCopy.stillWaiting)
      }
    } catch {
      setNotice(lineLinkCopy.failed)
    } finally {
      setBusy(false)
      setSession(readSessionSafely())
    }
  }

  /** ออกรหัสเชื่อมให้ผู้จ่ายคนเดียว — สร้างสมุด LINE ให้เองถ้ายังไม่มี (ครั้งแรกของครู) */
  const issue = async (clientId: string): Promise<LineLinkCode> => {
    const current = readSessionSafely()
    if (!current) throw new Error('no-session')
    if (state.lineProviderId && state.lineProviderId !== current.user.id) throw new Error('wrong-account')
    let id = workspace
    if (!id) {
      id = crypto.randomUUID()
      if (!dispatch({ type: 'lineWorkspace', id, providerId: current.user.id })) throw new Error('storage')
    }
    await flushErasures(id)
    const mapping = await syncClients(id, state.clients)
    const remote = mapping.find(c => c.local_client_key === clientId)
    if (!remote) throw new Error('client')
    const rows = await rpc<LineLinkCode[]>('issue_line_link_code', { p_client_id: remote.client_id })
    if (!rows[0]) throw new Error('code')
    setCodes(prev => ({ ...prev, [clientId]: rows[0] }))
    return rows[0]
  }

  const clientName = (clientId: string): string =>
    state.clients.find(c => c.id === clientId)?.name ?? 'ผู้ปกครอง'

  /** คัดลอกข้อความเชิญของรหัสที่มีอยู่ — ที่เดียวที่ประกอบข้อความ ทั้งตอนเชิญและตอนคัดลอกซ้ำ */
  const copyInviteFor = async (clientId: string, code: string): Promise<{ ok: boolean; notice: string }> => {
    const name = clientName(clientId)
    const copied = await copyText(lineInviteMessage({
      clientName: name, code,
      addFriendUrl: lineAddFriendUrl(channelRow?.basic_id), particle: state.provider.particle,
    }))
    const text = copied ? lineLinkCopy.copied(name) : lineLinkCopy.copyFailed(name, code)
    setNotice(text)
    return { ok: copied, notice: text }
  }

  /** ครูมีรหัสอยู่แล้วและอยากได้ข้อความเดิมอีกครั้ง — ห้ามออกรหัสใหม่ให้โดยไม่ได้ขอ */
  const copyInvite = async (clientId: string): Promise<{ ok: boolean; notice: string }> => {
    const issued = codes[clientId]
    if (!issued) return { ok: false, notice: '' }
    return copyInviteFor(clientId, issued.code)
  }

  /**
   * กดครั้งเดียวได้ทั้งรหัสและข้อความ — ผู้ปกครองต้องรู้ลิงก์แอดกับรหัสพร้อมกัน
   * คัดลอกไม่ผ่านไม่ใช่ความล้มเหลว: รหัสออกไปแล้ว ครูต้องเห็นรหัสนั้นเพื่อส่งเอง
   */
  const invite = async (clientId: string): Promise<{ ok: boolean; notice: string }> => {
    if (!oaAvailable(state) || working.current) return { ok: false, notice: '' }
    working.current = true; setBusy(true); setNotice('')
    const settle = (ok: boolean, text: string) => { setNotice(text); return { ok, notice: text } }
    try {
      const issued = await issue(clientId)
      const copied = await copyInviteFor(clientId, issued.code)
      return { ok: true, notice: copied.notice }
    } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      return settle(false, reason === 'wrong-account' ? lineLinkCopy.wrongAccount
        : reason === 'no-session' ? lineLinkCopy.needSignIn : lineLinkCopy.failed)
    } finally {
      working.current = false; setBusy(false); setSession(readSessionSafely())
    }
  }

  /** งานอื่นบนหน้าตั้งค่า (เชื่อม/ยกเลิกการเชื่อม) ใช้ตัวจับ busy+notice ตัวเดียวกัน */
  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setNotice('')
    try { await work() } catch { setNotice(lineLinkCopy.failed) }
    finally { setBusy(false); setSession(readSessionSafely()) }
  }

  /** เข้าสู่ระบบ/ออกจากระบบเพิ่งเกิด — รับ session ที่ฟอร์มส่งมาได้เลย ไม่ต้องรอ storage */
  const reloadSession = (given?: SupabaseSession | null): SupabaseSession | null => {
    const next = given === undefined ? readSessionSafely() : given
    setSession(next)
    if (claimOwner(next?.user.id ?? null)) { setCodes({}); notify() }
    return next
  }

  return {
    session, channel: channelRow, channelLoaded, codes, busy, notice, wrongAccount: mismatch,
    status, invite, issue, copyInvite, refresh, run, reloadSession, setNotice,
    clearCodes: () => setCodes({}),
  }
}

/** หัวแท็บแอดมิน: ครูเชื่อม LINE OA แล้วหรือยัง — บรรทัดเดียว ไม่ขึ้นเลยถ้าโปรเจกต์นี้ไม่มี OA (เจ้าของ 13 ก.ย. 04:43) */
export function LineOaStatus() {
  const { state } = useStore()
  const link = useLineLink()
  if (!oaAvailable(state)) return null
  if (!link.session) return <p className="hint" data-testid="oa-status"><Link to="/app/settings/line">{lineLinkCopy.oaSignIn}</Link></p>
  if (!link.channelLoaded) return null
  if (link.channel?.status !== 'active') return <p className="hint" data-testid="oa-status"><Link to="/app/settings/line">{lineLinkCopy.oaSetup}</Link></p>
  return <p className="hint" data-testid="oa-status">{lineLinkCopy.linked}{link.channel.display_name ? ` · ${link.channel.display_name}` : ''}</p>
}

/**
 * ปุ่มเชิญผู้ปกครองที่วางข้าง ๆ ปุ่ม "ส่งใน LINE" — หน้านักเรียนและหน้าตั้งค่า OA (การ์ดในแอดมิน 3 แท็บใช้ variant="status" ไม่มีปุ่ม)
 *
 * กับดัก J-44: ห้ามครอบหรือย้าย LineMessageAction ปุ่มนี้จึงเป็นพี่น้องที่ต่อ*ท้าย*เสมอ
 * ไม่มีการส่งอะไรจากปุ่มนี้ และไม่แตะสถานะข้อความ — เชิญแล้วข้อความยังเป็นร่างเหมือนเดิม
 */
export function LineInviteAction({ clientId, disabled = false, variant = 'button' }: { clientId: string; disabled?: boolean; variant?: 'button' | 'status' }) {
  const { state } = useStore()
  const link = useLineLink([clientId])
  if (!oaAvailable(state)) return null
  // การ์ดข้อความในแอดมิน: ไม่มีปุ่ม บอกแค่ว่าผู้ปกครองคนนี้ยังไม่ได้แอด OA (คนที่ผูกแล้วไม่ต้องบอกอะไร)
  // สถานะของครูเอง (ยังไม่เข้าสู่ระบบ / ยังไม่เชื่อมช่อง) อยู่ที่หัวแท็บ <LineOaStatus/> ไม่ต้องซ้ำทุกการ์ด
  if (variant === 'status') {
    if (!link.session || !link.channelLoaded || link.channel?.status !== 'active') return null
    return link.status(clientId) === 'unlinked' ? <p className="hint" data-testid="line-unlinked">{lineLinkCopy.unlinkedParent}</p> : null
  }
  if (!link.session) {
    return <Link className="btn btn--ghost btn--sm" to="/app/settings/line">{lineLinkCopy.inviteSignedOut}</Link>
  }
  // ยังอ่านช่อง OA ไม่เสร็จ = ยังไม่รู้ว่าจะขึ้นปุ่มไหน รอก่อนดีกว่าขึ้นผิดแล้วสลับ
  if (!link.channelLoaded) return null
  if (link.channel?.status !== 'active') {
    return <Link className="btn btn--ghost btn--sm" to="/app/settings/line">{lineLinkCopy.setup}</Link>
  }
  // ยังไม่รู้สถานะ = ยังไม่ขึ้นปุ่มอะไร ไม่งั้นจอกระโดดไปสถานะที่ผิดแล้วค่อยกลับ
  // ยกเว้นครูเพิ่งกดปุ่มนี้ไป (มีข้อความแจ้งผลค้างอยู่) — ข้อความที่เพิ่งขึ้นห้ามหายระหว่างรอคำตอบ
  const status = link.status(clientId)
  // เชิญไปแล้ว (มีรหัสของคนนี้อยู่) ปุ่มตรวจสถานะต้องอยู่ต่อ แม้ข้อความแจ้งผลจะถูกล้างระหว่างตรวจรอบใหม่
  const invited = !!link.codes[clientId] || !!link.notice
  const invite = status === 'unlinked' || (status === 'unknown' && invited)
  // ผูกสำเร็จแล้วปุ่มต้องหาย แต่ต้องเหลือคำอธิบายไว้ว่าหายเพราะสำเร็จ
  if (!invite && !(status === 'linked' && invited)) return null
  return <>
    {invite && <div className="btnrow">
      <button className="btn btn--secondary btn--sm" disabled={link.busy || disabled}
        onClick={() => void link.invite(clientId)}>{lineLinkCopy.invite}</button>
      {invited && <button className="btn btn--ghost btn--sm" disabled={link.busy || disabled}
        onClick={() => void link.refresh([clientId])}>{lineLinkCopy.check}</button>}
    </div>}
    {link.notice && <p className="hint" role="status">{link.notice}</p>}
  </>
}
