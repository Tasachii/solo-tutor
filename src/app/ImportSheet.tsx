import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import { professionById } from '../professions'
import { copy } from '../copy'
import type { BillingMode, Subject } from '../core/types'
import {
  dedupeRows,
  detectMapping, parseDelimited, parseXlsx, toRows,
  type Field, type Grid, type Mapping,
} from '../core/importTable'
import { defaultBillingFor } from '../core/style'
import { BottomSheet } from './components'
import { useToast } from './components/Toast'
import { readPlanInfo, studentCapIssue, type CapIssue } from '../core/plan'
import { PlanSheet } from './PlanSheet'

const FIELDS: Field[] = ['name', 'payer', 'line', 'price']

/**
 * นำเข้ารายชื่อจากไฟล์ที่ติวเตอร์มีอยู่แล้ว
 * เดาคอลัมน์ให้ก่อน แล้วให้แก้เอง — เดาผิดแล้วนำเข้าเงียบ ๆ แย่กว่าให้กดยืนยันหนึ่งครั้ง
 */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore()
  const nav = useNavigate()
  const toast = useToast()
  const c = copy.importer
  const v = professionById(state.professionId).vocab
  const [grid, setGrid] = useState<Grid | null>(null)
  const [map, setMap] = useState<Mapping | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<BillingMode['mode']>(defaultBillingFor(state.style))
  const [price, setPrice] = useState('400')
  const [confirmSkipped, setConfirmSkipped] = useState(false)

  const load = (g: Grid) => {
    if (g.length === 0) { setErr(c.empty); return }
    setErr(''); setGrid(g); setMap(detectMapping(g))
  }

  const onFile = async (file: File) => {
    setErr('')
    try {
      if (/\.xlsx$/i.test(file.name)) load(await parseXlsx(await file.arrayBuffer()))
      else load(parseDelimited(await file.text()))
    } catch {
      setErr(c.unreadable)
    }
  }

  const parsed = useMemo(() => (grid && map ? toRows(grid, map) : []), [grid, map])
  // ตัดซ้ำในลิสต์และข้ามคนที่มีอยู่แล้ว — สร้าง "น้องปลา" ซ้ำสองคนแทบไม่เคยเป็นสิ่งที่ครูตั้งใจ
  const deduped = useMemo(() => dedupeRows(parsed, state.subjects.map((s) => s.name)), [parsed, state.subjects])
  const rows = deduped.rows
  const good = rows.filter((r) => !r.error)
  const [packTotal, setPackTotal] = useState('10')
  const packNum = Math.round(Number(packTotal))
  const packOk = Number.isInteger(packNum) && packNum > 0
  const bad = rows.length - good.length
  const priceNum = Math.round(Number(price))
  const priceOk = Number.isFinite(priceNum) && priceNum > 0

  const billingFor = (rowPrice?: number): Subject['billing'] | undefined => {
    const amount = rowPrice ?? priceNum
    if (mode === 'per_unit') return { mode, rate: amount }
    if (mode === 'flat_monthly') return { mode, amount }
    // แพ็ก: ราคาเป็นราคาต่อแพ็ก จำนวนครั้งใช้ค่าเริ่มต้นเดียวกันทุกคน ซื้อวันนี้
    return { mode: 'package', total: packNum, price: amount, purchasedAt: state.today }
  }

  const [capIssue, setCapIssue] = useState<CapIssue | null>(null)
  const confirm = () => {
    if (!good.length || !priceOk || (mode === 'package' && !packOk)) return
    const issue = studentCapIssue(state, readPlanInfo(), good.length)
    if (issue) { setCapIssue(issue); return }
    if (bad > 0 && !confirmSkipped) { setConfirmSkipped(true); return }
    const ok = dispatch({
      type: 'bulkAddSubjects',
      billing: billingFor() ?? { mode: 'per_unit', rate: priceNum },
      rows: good.map((r) => ({
        name: r.name, clientName: r.clientName, lineId: r.lineId,
        billing: r.price ? billingFor(r.price) : undefined,
      })),
    })
    if (!ok) { toast.push({ text: copy.common.saveFailed, tone: 'danger' }); return }
    toast.push({ text: `${c.done} ${good.length} ${v.units === 'ครั้ง' ? 'คน' : 'ราย'}`, tone: 'ok' })
    onClose()
    nav('/app/subjects')
  }

  return (
    <BottomSheet title={c.title} sub={c.sub} onClose={onClose}
      footer={grid
        ? <button className="btn btn--primary btn--block" disabled={!good.length || !priceOk || (mode === 'package' && !packOk)} onClick={confirm}>
            {confirmSkipped && bad > 0 ? `ยืนยันข้าม ${bad} แถว` : c.confirm} ({good.length})
          </button>
        : undefined}>
      {!grid && (
        <>
          <label className="fld">
            <span className="fld__l">{c.fromFile}</span>
            <input className="inp" type="file" accept=".csv,.tsv,.txt,.xlsx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
            <span className="hint">{c.fileHint}</span>
          </label>
          <label className="fld">
            <span className="fld__l">{c.fromPaste}</span>
            <textarea className="inp inp--area" rows={5} value={text} placeholder={c.pasteHint}
              onChange={(e) => setText(e.target.value)} />
          </label>
          <button className="btn btn--secondary btn--block" disabled={!text.trim()}
            onClick={() => load(parseDelimited(text))}>{c.readPaste}</button>
          {err && <span className="fld__err">{err}</span>}
        </>
      )}

      {grid && map && (
        <>
          <div className="fld">
            <span className="fld__l">{c.mapping}</span>
            <div className="maprow">
              {FIELDS.map((f) => (
                <label key={f} className="mapcell">
                  <span className="dim">{c.fields[f]}</span>
                  <select className="inp" value={map[f]} onChange={(e) => { setConfirmSkipped(false); setMap({ ...map, [f]: Number(e.target.value) }) }}>
                    <option value={-1}>{c.none}</option>
                    {(grid[0] ?? []).map((h, i) => (
                      <option key={i} value={i}>{map.header && h.trim() ? h : `${c.column} ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={map.header} onChange={(e) => { setConfirmSkipped(false); setMap({ ...map, header: e.target.checked }) }} />
              <span>{c.hasHeader}</span>
            </label>
          </div>

          <div className="fld">
            <span className="fld__l">{copy.onboarding.defaultMode}</span>
            <div className="chips">
              {(['per_unit', 'flat_monthly', 'package'] as BillingMode['mode'][]).map((m) => (
                <button key={m} type="button" className={`chip${mode === m ? ' chip--on' : ''}`} aria-pressed={mode === m}
                  onClick={() => setMode(m)}>{copy.waitlist.modeLabels[m]}</button>
              ))}
            </div>
            <input className="inp" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
            <span className="hint">{c.priceHint}</span>
            {!priceOk && <span className="fld__err">{copy.common.numberPositive}</span>}
          </div>
          {mode === 'package' && (
              <label className="fld" data-testid="pack-total"><span className="fld__l">{copy.subjects.fieldPackTotal}</span>
                <input className="inp" inputMode="numeric" value={packTotal} onChange={(e) => setPackTotal(e.target.value)} />
                {!packOk && <span className="fld__err">{copy.common.numberPositive}</span>}
              </label>
            )}
            {(deduped.duplicatesInList > 0 || deduped.existing.length > 0) && (
              <p className="warnbar" role="status">
                {deduped.duplicatesInList > 0 && `${c.dupInList.replace('{n}', String(deduped.duplicatesInList))} `}
                {deduped.existing.length > 0 && c.dupExisting.replace('{n}', String(deduped.existing.length)).replace('{names}', deduped.existing.slice(0, 3).join(', '))}
              </p>
            )}

          <div className="fld">
            <span className="fld__l">{c.preview} {rows.length}</span>
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>{c.fields.name}</th><th>{c.fields.payer}</th><th>{c.fields.line}</th><th>{c.fields.price}</th></tr></thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className={r.error ? 'tr--bad' : ''}>
                      <td>{r.error ? <span className="err">{r.error}</span> : r.name}</td>
                      <td>{r.clientName}</td><td className="dim">{r.lineId ?? ''}</td>
                      <td className="num">{r.price ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 8 && <span className="hint">{c.andMore} {rows.length - 8}</span>}
            {bad > 0 && <span className="hint hint--bad" role="alert">{c.skipped} {bad} · กดนำเข้าอีกครั้งเพื่อยืนยันว่าจะข้าม</span>}
          </div>

          <button className="btn btn--ghost btn--sm" onClick={() => { setGrid(null); setMap(null) }}>{c.pickAnother}</button>
        </>
      )}
      {capIssue && <PlanSheet issue={capIssue} onClose={() => setCapIssue(null)} />}
    </BottomSheet>
  )
}
