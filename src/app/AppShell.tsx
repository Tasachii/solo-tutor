import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../core/store'
import type { AppState } from '../core/types'
import { pickBackup, saveBackup } from './backup'
import { SCHEMA } from '../core/store'
import { useToast } from './components/Toast'
import { professionById } from '../professions'
import { copy } from '../copy'
import { draftCount } from '../core/selectors'
import { BottomSheet, ConfirmSheet, DemoBadge, Icon, PenguinMark, type IconName } from './components'
import { ProfileSheet } from './ProfileSheet'
import { SheetsSheet } from './SheetsSheet'
import { ImportSheet } from './ImportSheet'
import { download, rosterCsv } from '../core/export'
import { readSheetsConfig, writeSheetsConfig, pushToSheets } from './sheetsSync'
import { shouldSync } from '../core/sheets'
import { SCENARIOS, SCENARIO_LABEL, type ScenarioId } from '../core/scenarios'
import { THEMES, applyTheme, readTheme, type Theme } from '../core/theme'
import { applySize, readSize, type DisplaySize } from '../core/display'
import { ACCENTS, applyAccent, readAccent, type Accent } from '../core/accent'
import { applyFrame, isFullscreen, readFrame, toggleFullscreen, type Frame } from '../core/present'

type MenuTab = 'general' | 'display' | 'demo'

export default function AppShell() {
  const { state, dispatch, resetDemo, track } = useStore()
  const prof = professionById(state.professionId)
  const nav = useNavigate()
  const loc = useLocation()
  const [menu, setMenu] = useState(false)
  const [menuTab, setMenuTab] = useState<MenuTab>('general')
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [size, setSize] = useState<DisplaySize>(readSize)
  const [accent, setAccent] = useState<Accent>(readAccent)
  const [frame, setFrame] = useState<Frame>(readFrame)
  const [keys, setKeys] = useState(false)
  const [profile, setProfile] = useState(false)
  const [sheetsOpen, setSheetsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [sheets, setSheets] = useState(readSheetsConfig)
  const [full, setFull] = useState(isFullscreen)
  // ป้าย "เต็มจอ" ต้องกลับเป็น "ยกเลิกเต็มจอ" เมื่ออยู่ในโหมดนั้น — ไม่ว่าเข้าด้วยปุ่มหรือคีย์ F
  useEffect(() => {
    const sync = () => setFull(isFullscreen())
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  // ask = สิ่งที่กำลังถามยืนยันอยู่ (แทน window.confirm ที่ใช้ไม่ได้บน PWA)
  const [ask, setAsk] = useState<null | 'toDemo' | 'toReal' | { restore: AppState; cross: boolean }>(null)
  const real = state.mode === 'real'
  const toast = useToast()
  const drafts = draftCount(state)

  // ยังไม่มีข้อมูลเลย = พาไป onboarding ก่อน
  useEffect(() => {
    if (!state.onboarded && state.subjects.length === 0 && !loc.pathname.endsWith('/onboarding')) {
      nav('/app/onboarding', { replace: true })
    }
  }, [state.onboarded, state.subjects.length, loc.pathname, nav])

  // ส่งขึ้นชีตเมื่อข้อมูลเปลี่ยน — หน่วงไว้ ไม่ยิงทุกการกด และไม่ยิงในโหมดเดโม
  useEffect(() => {
    if (!shouldSync(sheets, state.mode, Date.now()).due) return
    const t = setTimeout(() => {
      const at = new Date().toISOString()
      void pushToSheets(state, sheets!, at).then((res) => {
        if (!res.ok) return
        const next = { ...sheets!, lastSyncAt: at, lastSyncConfirmed: res.confirmed }
        writeSheetsConfig(next)
        setSheets(next)
      })
    }, 4000)
    return () => clearTimeout(t)
  }, [state, sheets])

  // คีย์ลัดสำหรับตอนพรีเซนต์ — ไม่จับเมื่อกำลังพิมพ์อยู่ในช่องกรอก
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (document.querySelector('[role="dialog"]')) return
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      const go = (i: number) => nav(['/app/today', '/app/subjects', '/app/billing', '/app/admin'][i])
      const sizes: DisplaySize[] = ['sm', 'lg', 'xl']
      switch (e.key) {
        case '1': case '2': case '3': case '4': go(Number(e.key) - 1); break
        case 'f': case 'F': void toggleFullscreen(); break
        case 'w': case 'W': {
          const next: Frame = readFrame() === 'web' ? 'phone' : 'web'
          setFrame(next); applyFrame(next); break
        }
        case 'd': case 'D': {
          const next: Theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
          setTheme(next); applyTheme(next); break
        }
        case '+': case '=': case '-': case '_': {
          const at = sizes.indexOf(readSize())
          const to = sizes[Math.min(sizes.length - 1, Math.max(0, at + (e.key === '-' || e.key === '_' ? -1 : 1)))]
          setSize(to); applySize(to); break
        }
        case '?': setKeys(true); break
        case 'Escape': setKeys(false); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav])

  const tabs = [
    { to: '/app/today', label: copy.nav.today, icon: 'cal' as IconName },
    { to: '/app/subjects', label: prof.vocab.subjects, icon: 'users' as IconName },
    { to: '/app/billing', label: copy.nav.billing, icon: 'bill' as IconName },
    { to: '/app/admin', label: copy.nav.admin, badge: drafts, icon: 'chat' as IconName },
  ]

  return (
    <div className="shell">
      <header className="shell__hd">
        <b className="shell__brand"><PenguinMark size={28} />{copy.brand.name}</b>
        {/* ครูต้องรู้ตลอดว่ากำลังแตะข้อมูลจริงหรือข้อมูลสมมติ */}
        {real && <span className="realtag">{copy.menu.realOn}</span>}
        <div className="shell__hdr">
          {!real && <DemoBadge />}
          <button className="shell__menu" onClick={() => setMenu(true)} aria-label={copy.menu.title}>⋯</button>
        </div>
      </header>

      <main className="shell__main"><Outlet /></main>

      <nav className="tabbar">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? ' tab--on' : ''}`}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.badge ? <i className="tab__badge">{t.badge}</i> : null}
          </NavLink>
        ))}
      </nav>

      {menu && (
        <BottomSheet title={copy.menu.title} onClose={() => setMenu(false)}>
          {/* เมนูยาวเกินจอ — แยกเป็น 3 หมวด: งานประจำ · หน้าจอ · เดโม */}
          <div className="seg" role="tablist" aria-label={copy.menu.title}>
            {(['general', 'display', 'demo'] as MenuTab[]).filter((t) => t !== 'demo' || !real).map((t) => (
              <button key={t} role="tab" aria-selected={menuTab === t} className={`seg__b${menuTab === t ? ' seg__b--on' : ''}`}
                onClick={() => setMenuTab(t)}>{copy.menu.tabs[t]}</button>
            ))}
          </div>

          {menuTab === 'general' && (
            <>
              <div className="rows rows--menu">
                {real ? (
                  <>
                    <button className="row" onClick={() => { setMenu(false); setProfile(true) }}>{copy.menu.profile}</button>
                    <button className="row" onClick={() => { setMenu(false); setAsk('toDemo') }}>{copy.menu.backToDemo}</button>
                  </>
                ) : (
                  <button className="row row--go" onClick={() => { setMenu(false); setAsk('toReal') }}>{copy.menu.startReal}</button>
                )}
                <button className="row" onClick={() => { setMenu(false); nav('/start') }}>{copy.menu.style}</button>
                {state.clients[0] && (
                  <button className="row" onClick={() => { setMenu(false); nav(`/client/${state.clients[0].id}`) }}>
                    {copy.menu.clientView}
                  </button>
                )}
              </div>
              <div className="fld__l menu__h">{copy.menu.secData}</div>
              <div className="rows rows--menu">
                <button className="row" onClick={async () => {
                  setMenu(false)
                  const ok = await saveBackup(state)
                  // จด lastBackupAt เฉพาะเมื่อได้ไฟล์จริง ไม่งั้นคำเตือน 7 วันจะเงียบทั้งที่ไม่มีไฟล์
                  if (ok) { dispatch({ type: 'backedUp' }); track('backup_save'); toast.push({ text: copy.menu.backupDone, tone: 'ok' }) }
                  else toast.push({ text: copy.menu.backupFailed, tone: 'danger' })
                }}>{copy.menu.backup}</button>
                <button className="row" onClick={async () => {
                  setMenu(false) // ปิดเมนูก่อนเปิดตัวเลือกไฟล์ของระบบ
                  const res = await pickBackup(SCHEMA)
                  if (!res) return
                  if (!res.ok) { toast.push({ text: `${copy.menu.restoreBad[res.reason]}${res.details?.length ? ` · ${res.details[0]}` : ''}`, tone: 'danger' }); return }
                  // ไฟล์คนละโหมดกับที่ใช้อยู่ = กำลังจะทับข้อมูลจริงด้วยเดโม หรือกลับกัน
                  setAsk({ restore: res.state, cross: res.state.mode !== state.mode })
                }}>{copy.menu.restore}</button>
                <button className="row" onClick={() => { setMenu(false); setImportOpen(true) }}>{copy.importer.menu}</button>
                <button className="row" onClick={() => { setMenu(false); download(rosterCsv(state), `รายชื่อ-${state.today}.csv`, 'text/csv;charset=utf-8') }}>{copy.importer.exportMenu}</button>
                <button className="row" onClick={() => { setMenu(false); nav('/app/settings/line') }}>เชื่อม LINE OA</button>
                <button className="row" onClick={() => { setMenu(false); setSheetsOpen(true) }}>{copy.sheets.menu}</button>
                {!real && <button className="row" onClick={() => { resetDemo(); setMenu(false) }}>{copy.menu.reset}</button>}
              </div>
            </>
          )}

          {menuTab === 'display' && (
            <>
              <div className="fld">
                <div className="fld__l">{copy.menu.theme}</div>
                <div className="chips">
                  {THEMES.map((tm) => (
                    <button key={tm} className={`chip${theme === tm ? ' chip--on' : ''}`}
                      aria-pressed={theme === tm}
                      onClick={() => { setTheme(tm); applyTheme(tm); track('theme_switch', { theme: tm }) }}>
                      {copy.menu.themes[tm]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fld">
                <div className="fld__l">{copy.menu.accent}</div>
                <div className="chips">
                  {ACCENTS.map((a) => (
                    <button key={a} className={`chip chip--dot${accent === a ? ' chip--on' : ''}`} aria-pressed={accent === a}
                      data-accent-swatch={a}
                      onClick={() => { setAccent(a); applyAccent(a); track('accent_switch', { accent: a }) }}>
                      {copy.menu.accents[a]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fld2">
                <div className="fld">
                  <div className="fld__l">{copy.menu.size}</div>
                  <div className="chips">
                    {(['sm', 'lg', 'xl'] as DisplaySize[]).map((z) => (
                      <button key={z} className={`chip${size === z ? ' chip--on' : ''}`}
                        aria-pressed={size === z}
                        onClick={() => { setSize(z); applySize(z); track('size_switch', { size: z }) }}>
                        {copy.menu.sizes[z]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fld">
                  <div className="fld__l">{copy.menu.frame}</div>
                  <div className="chips">
                    {(['phone', 'web'] as Frame[]).map((f) => (
                      <button key={f} className={`chip${frame === f ? ' chip--on' : ''}`} aria-pressed={frame === f}
                        onClick={() => { setFrame(f); applyFrame(f); track('frame_switch', { frame: f }) }}>
                        {copy.menu.frames[f]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rows rows--menu">
                <button className="row" onClick={() => { void toggleFullscreen(); setMenu(false) }}>{full ? copy.menu.exitFullscreen : copy.menu.fullscreen}</button>
                <button className="row" onClick={() => { setKeys(true); setMenu(false) }}>{copy.menu.shortcuts}</button>
              </div>
            </>
          )}

          {menuTab === 'demo' && !real && (
            <div className="fld">
              <div className="fld__l">{copy.menu.scenario}</div>
              <p className="hint">{copy.menu.scenarioHint}</p>
              <div className="chips">
                {SCENARIOS.map((sc) => (
                  <button key={sc} className={`chip${state.scenarioId === sc ? ' chip--on' : ''}`}
                    aria-pressed={state.scenarioId === sc}
                    onClick={() => { resetDemo(sc as ScenarioId); track('scenario_switch', { scenario: sc }); setMenu(false); nav('/app/today') }}>
                    {SCENARIO_LABEL[sc]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </BottomSheet>
      )}

      {profile && <ProfileSheet onClose={() => setProfile(false)} />}

      {sheetsOpen && <SheetsSheet current={sheets} onSaved={setSheets} onClose={() => setSheetsOpen(false)} />}

      {importOpen && <ImportSheet onClose={() => setImportOpen(false)} />}

      {keys && (
        <BottomSheet title={copy.menu.shortcuts} onClose={() => setKeys(false)}>
          <ul className="keys">
            {copy.menu.keys.map((k) => (
              <li key={k.k}><kbd>{k.k}</kbd><span>{k.d}</span></li>
            ))}
          </ul>
        </BottomSheet>
      )}

      {ask === 'toDemo' && (
        <ConfirmSheet title={copy.menu.backToDemo} body={copy.menu.backToDemoConfirm}
          confirmLabel={copy.menu.backToDemo} danger
          onClose={() => setAsk(null)}
          onConfirm={async () => {
            // ต้องได้ไฟล์สำรองก่อน ไม่งั้นข้อมูลเดือนหนึ่งหายโดยไม่มีทางกู้
            if (!(await saveBackup(state))) { toast.push({ text: copy.menu.backupFailed, tone: 'danger' }); return false }
            if (!resetDemo('default')) return false
            setMenu(false); nav('/app/today')
            return true
          }} />
      )}
      {ask === 'toReal' && (
        <ConfirmSheet title={copy.menu.startReal} body={copy.menu.startRealConfirm}
          confirmLabel={copy.menu.startReal}
          onClose={() => setAsk(null)}
          onConfirm={() => {
            if (!dispatch({ type: 'startReal' })) return false
            track('start_real')
            setMenu(false); nav('/app/onboarding')
            return true
          }} />
      )}
      {ask && typeof ask === 'object' && (
        <ConfirmSheet title={copy.menu.restore}
          body={`${ask.cross ? copy.menu.restoreCrossMode : copy.menu.restoreConfirm} (${ask.restore.subjects.length} รายการ · ${ask.restore.invoices.length} บิล · ${ask.restore.receipts.length} ใบเสร็จ) เก็บสำเนาข้อมูลปัจจุบันในเครื่องก่อนกู้คืน`}
          confirmLabel={copy.menu.restore} danger={ask.cross}
          onClose={() => setAsk(null)}
          onConfirm={() => {
            if (!dispatch({ type: 'restore', state: ask.restore })) return false
            track('backup_restore')
            setMenu(false); nav('/app/today'); toast.push({ text: copy.menu.restoreDone, tone: 'ok' })
            return true
          }} />
      )}
    </div>
  )
}
