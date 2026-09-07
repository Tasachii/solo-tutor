import { useState } from 'react'
import { useStore } from '../core/store'
import { professionById, professions } from '../professions'
import { copy } from '../copy'
import { BottomSheet } from '../app/components'
import { getSupabaseConfig } from '../integrations/supabaseRest'
import type { WaitlistEntry } from '../core/types'

const MODES = ['per_unit', 'flat_monthly', 'package'] as const

export const waitlistDate = (date = new Date()): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function waitlistDeliveryResult(endpoint: string, response: Pick<Response, 'ok' | 'type'> | null): 'local' | 'remote' {
  return endpoint && response?.ok && response.type !== 'opaque' ? 'remote' : 'local'
}

/** ปลายทางคือ Edge Function ของโปรเจกต์เดียวกับบัญชีครู — ไม่มีโปรเจกต์ = เก็บในเครื่องอย่างเดียว */
export const waitlistEndpoint = (): string => {
  const config = getSupabaseConfig()
  return config ? `${config.url}/functions/v1/waitlist` : ''
}

export default function WaitlistSheet({ preselect, onClose }: { preselect?: string; onClose: () => void }) {
  const { dispatch, track } = useStore()
  const [professionId, setProfessionId] = useState(preselect ?? professions.find((p) => p.status === 'live')?.id ?? professions[0].id)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [size, setSize] = useState('')
  const [modes, setModes] = useState<string[]>([])
  const [concierge, setConcierge] = useState(false)
  const [err, setErr] = useState<{ name?: string; contact?: string }>({})
  const [sending, setSending] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [done, setDone] = useState<'local' | 'remote' | null>(null)

  const toggleMode = (m: string) =>
    setModes((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]))

  const submit = async () => {
    const e: typeof err = {}
    if (!name.trim()) e.name = copy.common.required
    if (!contact.trim()) e.contact = copy.common.required
    setErr(e)
    if (Object.keys(e).length) return

    setSending(true)
    setSaveError('')
    const entry: WaitlistEntry = {
      professionId, name: name.trim(), contact: contact.trim(),
      size: size || undefined, modes: modes.length ? modes : undefined,
      concierge: professionById(professionId).conciergeAvailable ? concierge : undefined,
      at: waitlistDate(),
    }
    if (!dispatch({ type: 'waitlist', entry })) {
      setSending(false)
      setSaveError('บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ โปรดตรวจสิทธิ์เขียนของแท็บนี้แล้วลองอีกครั้ง')
      return
    }
    track('waitlist_submit', { professionId })

    let delivery: 'local' | 'remote' = 'local'
    const endpoint = waitlistEndpoint()
    if (endpoint) {
      try {
        // ส่งเฉพาะสิ่งที่ฟอร์มถาม — ไม่มีอะไรจาก state ของแอปติดไป
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ professionId: entry.professionId, name: entry.name, contact: entry.contact,
            size: entry.size, modes: entry.modes, concierge: entry.concierge }),
          signal: AbortSignal.timeout(10_000),
        })
        delivery = waitlistDeliveryResult(endpoint, response)
      } catch (error) {
        console.warn('[solo] waitlist post failed, kept locally', error)
      }
    }
    setSending(false)
    setDone(delivery)
  }

  if (done) {
    return (
      <BottomSheet title={done === 'remote' ? 'ส่งข้อมูลให้ทีมแล้ว' : 'บันทึกข้อมูลไว้ในเครื่องแล้ว'} onClose={onClose}
        footer={<button className="btn btn--primary btn--block" onClick={onClose}>{copy.common.close}</button>}>
        <p className="p">{done === 'remote'
          ? 'ระบบปลายทางยืนยันว่ารับข้อมูลแล้ว ทีมจะใช้ข้อมูลนี้เพื่อติดต่อกลับ'
          : 'ยังไม่มีการยืนยันว่าทีมได้รับข้อมูล กรุณาเก็บข้อมูลติดต่อไว้และลองใหม่เมื่อเปิดช่องทางรับข้อมูลแล้ว'}</p>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet
      title={copy.waitlist.title} sub={copy.waitlist.sub} onClose={onClose}
      footer={
        <button className="btn btn--primary btn--block" onClick={submit} disabled={sending}>
          {sending ? copy.waitlist.sending : copy.waitlist.submit}
        </button>
      }
    >
      {saveError && <p className="fld__err" role="alert">{saveError}</p>}
      <label className="fld">
        <span className="fld__l">{copy.waitlist.profession}</span>
        <select className="inp" value={professionId} onChange={(e) => setProfessionId(e.target.value)}>
          {professions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      <label className="fld">
        <span className="fld__l">{copy.waitlist.name}</span>
        <input className="inp" value={name} aria-invalid={!!err.name || undefined}
          aria-describedby={err.name ? 'waitlist-name-error' : undefined}
          onChange={(e) => { setName(e.target.value); setErr((old) => ({ ...old, name: undefined })) }} />
        {err.name && <span id="waitlist-name-error" className="fld__err">{err.name}</span>}
      </label>

      <label className="fld">
        <span className="fld__l">{copy.waitlist.contact}</span>
        <input className="inp" value={contact} aria-invalid={!!err.contact || undefined}
          aria-describedby={err.contact ? 'waitlist-contact-error' : undefined}
          onChange={(e) => { setContact(e.target.value); setErr((old) => ({ ...old, contact: undefined })) }} />
        {err.contact && <span id="waitlist-contact-error" className="fld__err">{err.contact}</span>}
      </label>

      <div className="fld">
        <span className="fld__l">{copy.waitlist.size}</span>
        <div className="chips">
          {copy.waitlist.sizes.map((sz) => (
            <button key={sz} className={`chip${size === sz ? ' chip--on' : ''}`}
              aria-pressed={size === sz} onClick={() => setSize(sz)}>{sz}</button>
          ))}
        </div>
      </div>

      <div className="fld">
        <span className="fld__l">{copy.waitlist.modes}</span>
        <div className="chips">
          {MODES.map((m) => (
            <button key={m} className={`chip${modes.includes(m) ? ' chip--on' : ''}`}
              aria-pressed={modes.includes(m)} onClick={() => toggleMode(m)}>
              {copy.waitlist.modeLabels[m]}
            </button>
          ))}
        </div>
      </div>

      {professionById(professionId).conciergeAvailable && (
        <label className="check">
          <input type="checkbox" checked={concierge} onChange={(e) => setConcierge(e.target.checked)} />
          <span>{copy.waitlist.concierge}</span>
        </label>
      )}

      <p className="hint">
        {copy.waitlist.privacy}{!waitlistEndpoint() && ' · ข้อมูลจะบันทึกในเครื่องนี้เท่านั้น ทีมยังไม่ได้รับข้อมูล'}
      </p>
    </BottomSheet>
  )
}
