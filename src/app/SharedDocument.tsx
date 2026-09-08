import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { readDocument, type SharedDocument as Doc } from '../core/documents'
import { importUrlKey, openDocument, parseDocumentRoute } from '../core/documentShare'
import { resolveSharedDocument } from '../core/sharedDocumentApi'
import { dateThai, dateThaiFull, money, periodThai } from '../core/format'
import { PromptPayQR } from './components'
import { copy } from '../copy'

/** วันหมดอายุที่ผู้ปกครองเห็น อ่านตามเวลาไทยเสมอ ไม่ใช่ตามเขตเวลาของเครื่องผู้รับ */
const bangkokDay = (iso: string): string | null => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

type Loaded = { doc: Doc; expiresAt: string | null; revocable: boolean }
type State =
  | { phase: 'loading' }
  | { phase: 'ready'; loaded: Loaded }
  | { phase: 'gone' }
  | { phase: 'tampered' }
  | { phase: 'offline' }
  | { phase: 'unavailable' }

/** Mounted outside StoreProvider: recipient never loads, modifies or inherits a workspace. */
export default function SharedDocument() {
  const { token = '' } = useParams()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    const route = parseDocumentRoute(token)
    if (!route.secure) {
      // ลิงก์รุ่นเดิมที่ผู้ปกครองถืออยู่แล้วต้องเปิดได้ต่อไป ข้อมูลทั้งใบอยู่ใน fragment ไม่ต้องถามเซิร์ฟเวอร์
      const doc = route.legacy ? readDocument(route.legacy) : null
      setState(doc
        ? { phase: 'ready', loaded: { doc, expiresAt: null, revocable: false } }
        : { phase: 'tampered' })
      return undefined
    }
    const { token: id, key: urlKey } = route.secure
    const abort = new AbortController()
    let live = true
    setState({ phase: 'loading' })
    void (async () => {
      // กุญแจถูกถอดจาก fragment บนเครื่องนี้เท่านั้น ไม่เคยถูกส่งไปกับคำขอใด
      const key = await importUrlKey(urlKey)
      if (!live) return
      if (!key) { setState({ phase: 'tampered' }); return }
      const found = await resolveSharedDocument(id, abort.signal)
      if (!live) return
      if (found.status !== 'ok') { setState({ phase: found.status }); return }
      const doc = await openDocument(key, { cipher: found.row.cipher, iv: found.row.iv })
      if (!live) return
      // ถอดรหัสไม่ผ่าน = กุญแจผิดหรือข้อมูลถูกแก้ · AES-GCM ตรวจให้แล้ว ไม่มีทางแสดงยอดที่ถูกแก้
      setState(doc
        ? { phase: 'ready', loaded: { doc, expiresAt: found.row.expiresAt, revocable: true } }
        : { phase: 'tampered' })
    })()
    return () => { live = false; abort.abort() }
  }, [token, attempt])

  const retry = useCallback(() => setAttempt(n => n + 1), [])
  const c = copy.sharedDoc

  if (state.phase === 'loading') {
    return <main className="page" role="status" aria-live="polite" aria-busy="true"><p>{c.loading}</p></main>
  }
  if (state.phase !== 'ready') {
    const message = state.phase === 'gone' ? c.gone
      : state.phase === 'offline' ? c.offline
        : state.phase === 'unavailable' ? c.unavailable : c.tampered
    return <main className="page">
      <h1 className="h1">{c.cannotOpen}</h1>
      <p>{message}</p>
      {state.phase === 'offline' && <button className="btn btn--primary" onClick={retry}>{c.retry}</button>}
    </main>
  }

  const { doc: d, expiresAt, revocable } = state.loaded
  const balance = d.total - d.paid
  const expiryDay = expiresAt ? bangkokDay(expiresAt) : null
  return <main className="page page--paper">
    <p className="hint no-print">สำเนาข้อมูล ณ {dateThai(d.asOf)} · ยอดในลิงก์นี้ไม่อัปเดตอัตโนมัติ</p>
    <article className="paper">
      <header className="paper__hd"><h1 className="paper__h1">{d.kind === 'receipt' ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งยอด'}</h1>{d.number && <b>{d.number}</b>}</header>
      <dl className="paper__meta">
        <div><dt>ผู้รับเงิน</dt><dd>{d.provider}</dd></div>
        <div><dt>ผู้จ่าย</dt><dd>{d.payer} ({d.subject})</dd></div>
        <div><dt>เดือน</dt><dd>{periodThai(d.period)}</dd></div>
        <div><dt>วันที่เอกสาร</dt><dd>{dateThai(d.asOf)}</dd></div>
        {d.dueAt && <div><dt>ครบกำหนด</dt><dd>{dateThai(d.dueAt)}</dd></div>}
      </dl>
      <table className="paper__tbl"><thead><tr><th>รายการ</th><th className="r">บาท</th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody>
        <tfoot><tr><td>ยอดรวม</td><td className="r num">{money(d.total)}</td></tr></tfoot>
      </table>
      <p>รับชำระแล้ว <b className="num">{money(d.paid)} บาท</b></p>
      <p>คงเหลือ <b className="num">{money(balance)} บาท</b></p>
      {balance > 0 && <div className="card">
        {/* ลิงก์นี้คือสิ่งที่ผู้ปกครองได้รับจริง — สแกนจากตรงนี้ได้เลยถ้าปลายทางใช้ได้ */}
        {d.destination && <PromptPayQR destination={d.destination} amount={balance}
          label={copy.clientView.scanToPay} sub={copy.clientView.scanAmount.replace('{n}', money(balance))} />}
        <p>โอนผ่านพร้อมเพย์</p><strong>{d.destination || 'กรุณาติดต่อผู้ส่งเพื่อขอข้อมูลชำระเงิน'}</strong><p className="hint">ตรวจชื่อผู้รับในแอปธนาคารให้ตรงกับผู้ให้บริการก่อนยืนยันโอน</p></div>}
      <p className="paper__fine">สำเนาที่ผู้ส่งจัดทำ · Solo Tutor ไม่ได้รับรองลายเซ็นหรือยืนยันการโอนเงิน ติดต่อผู้ส่งเพื่อตรวจสอบยอดล่าสุด</p>
    </article>
    {/* เพิกถอนได้ = ปิดการเปิดครั้งต่อไปเท่านั้น สำเนาที่เปิดหรือบันทึกไปแล้วเรียกคืนไม่ได้ ต้องเขียนให้ตรงตามนั้น */}
    {revocable
      ? <p className="hint no-print">
          {expiryDay ? `${c.opensUntil} ${dateThaiFull(expiryDay)} · ` : ''}{c.revocableNote}
        </p>
      : <p className="hint no-print">{c.legacyNote}</p>}
    <button className="btn btn--primary no-print" onClick={() => window.print()}>พิมพ์ / บันทึก PDF</button>
  </main>
}
