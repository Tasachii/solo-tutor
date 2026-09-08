import { Suspense, useEffect, useRef } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from './core/store'
import { lazyRoute } from './core/lazyRoute'
import { adoptAudience, currentSessionId, routeCategory, sendUsage } from './core/usage'
import { countDemoSteps, demoLoopComplete, earnedSteps, type DemoLoopStep, type StepCounts } from './core/funnel'

import Landing from './platform/Landing'
import { CloudSyncProvider } from './app/CloudSync'

const Pricing = lazyRoute(() => import('./platform/Pricing'))
const StylePicker = lazyRoute(() => import('./platform/StylePicker'))
const Legal = lazyRoute(() => import('./platform/Legal'))
const Login = lazyRoute(() => import('./platform/Login'))
const AppShell = lazyRoute(() => import('./app/AppShell'))
const Today = lazyRoute(() => import('./app/Today'))
const Subjects = lazyRoute(() => import('./app/Subjects'))
const SubjectDetail = lazyRoute(() => import('./app/SubjectDetail'))
const Billing = lazyRoute(() => import('./app/Billing'))
const Admin = lazyRoute(() => import('./app/Admin'))
const ReceiptList = lazyRoute(() => import('./app/ReceiptList'))
const Onboarding = lazyRoute(() => import('./app/Onboarding'))
const Receipt = lazyRoute(() => import('./app/Receipt'))
const ClientPreview = lazyRoute(() => import('./app/ClientPreview'))
const LineSettings = lazyRoute(() => import('./app/LineSettings'))
const Account = lazyRoute(() => import('./app/Account'))
const Help = lazyRoute(() => import('./app/Help'))

function RouteLoading() {
  return <main className="pane" role="status" aria-live="polite" aria-busy="true">
    <p>กำลังเปิดหน้า…</p>
  </main>
}

export default function App() {
  const { state, track, ledgerReplacements } = useStore()
  const loc = useLocation()
  // หมวดหน้า ไม่ใช่ path จริง — /document/:token, /receipt/:id, /client/:id ได้ null คือไม่ส่งอะไรเลย
  const route = routeCategory(loc.pathname)
  const inApp = route === 'app'

  useEffect(() => { track('app_open') }, [track])

  // แกน QA/ทีม: ?qa=1 ติดเครื่องไว้จนกว่าจะ ?qa=0 — Demo ของผู้สนใจยังนับเป็น acquisition ตามเดิม
  useEffect(() => { adoptAudience(window.location.search); adoptAudience(loc.search) }, [loc.search])

  // Pageview ผูกกับการเปลี่ยนหน้าใน history — re-render ที่ไม่เปลี่ยนหน้าไม่เข้าเงื่อนไขนี้
  // และ key ของ history ทำให้ effect ที่รันซ้ำบนหน้าเดิมได้ event_id เดิม เซิร์ฟเวอร์จึงไม่นับซ้ำ
  useEffect(() => {
    if (route !== 'landing' && route !== 'pricing') return
    const event = route === 'landing' ? 'landing_view' : 'pricing_view'
    sendUsage(event, 1, { route, key: `view:${loc.key}:${route}` })
  }, [route, loc.key])

  // เปิดแอปจริง = เข้าพื้นที่ /app ไม่ใช่เปิดหน้าขาย — หนึ่งครั้งต่อ session ต่อโหมด
  useEffect(() => {
    if (!inApp) return
    sendUsage('app_open', 1, { route: 'app', mode: state.mode, key: `app_open:${currentSessionId()}:${state.mode}` })
  }, [inApp, state.mode])

  // ครบลูป Demo = ผู้ใช้กดบันทึกคาบและปิดยอดออกบิลจริงในเครื่องนี้ ไม่ใช่มีรายการยาวขึ้น
  const demo = useRef<{ counts: StepCounts; earned: DemoLoopStep[]; replacements: number } | null>(null)
  useEffect(() => {
    const counts = countDemoSteps(state.events)
    const prev = demo.current
    // ครั้งแรกและทุกครั้งที่สมุดบัญชีถูกยกมาทั้งก้อน — ตั้งฐานใหม่เงียบ ๆ ไม่รายงานขั้นที่ติดมากับก้อนนั้น
    if (!prev || ledgerReplacements !== prev.replacements) {
      demo.current = { counts, earned: [], replacements: ledgerReplacements }
      return
    }
    const earned = earnedSteps(prev.counts, counts, prev.earned)
    demo.current = { counts, earned, replacements: ledgerReplacements }
    if (state.mode !== 'demo' || !demoLoopComplete(earned)) return
    sendUsage('demo_completed', 1, { mode: 'demo', key: `demo_completed:${currentSessionId()}` })
  }, [state.events, state.mode, ledgerReplacements])

  // ตัวนับ 3 เหตุการณ์สำหรับทีม — ดูจากความยาวรายการที่เปลี่ยน ไม่ต้องแตะ reducer
  // นับได้เฉพาะงานที่ครูลงมือทำในเครื่องนี้: กู้คืนไฟล์ ดึงคลาวด์ เริ่มใช้จริง หรืออ่านก้อนใหม่จากเครื่อง
  // ทำให้ความยาวรายการกระโดดโดยไม่มีใครทำงานเพิ่ม ถ้านับด้วยจะได้ตัวเลขที่เข้าข้างตัวเอง
  const seen = useRef({ subjects: state.subjects.length, invoices: state.invoices.length,
    payments: state.payments.length, replacements: ledgerReplacements })
  useEffect(() => {
    const prev = seen.current
    const next = { subjects: state.subjects.length, invoices: state.invoices.length,
      payments: state.payments.length, replacements: ledgerReplacements }
    seen.current = next
    // ยกสมุดบัญชีทั้งก้อน — ตั้งฐานใหม่เงียบ ๆ เพื่อให้งานจริงชิ้นถัดไปยังรายงานส่วนต่างที่ถูกต้อง
    if (next.replacements !== prev.replacements) return
    if (next.subjects !== prev.subjects) sendUsage('students_changed', next.subjects, { mode: state.mode })
    if (next.invoices > prev.invoices) sendUsage('invoice_issued', next.invoices - prev.invoices, { mode: state.mode })
    if (next.payments > prev.payments) sendUsage('payment_recorded', next.payments - prev.payments, { mode: state.mode })
  }, [state.subjects.length, state.invoices.length, state.payments.length, state.mode, ledgerReplacements])
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/start" element={<StylePicker />} />
        {/* ห่อ CloudSyncProvider เพื่อรอผลดึงข้อมูลจากคลาวด์ก่อนพาเข้าแอป */}
        <Route path="/login" element={<CloudSyncProvider><Login /></CloudSyncProvider>} />
        <Route path="/receipt/:id" element={<Receipt />} />
        <Route path="/client/:clientId" element={<ClientPreview />} />
        <Route path="/app" element={<CloudSyncProvider><AppShell /></CloudSyncProvider>}>
          <Route index element={<Navigate to="/app/today" replace />} />
          <Route path="today" element={<Today />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="subjects/:id" element={<SubjectDetail />} />
          <Route path="billing" element={<Billing />} />
          <Route path="admin" element={<Admin />} />
          <Route path="settings/line" element={<LineSettings />} />
          <Route path="settings/account" element={<Account />} />
          <Route path="help" element={<Help />} />
          <Route path="receipts" element={<ReceiptList />} />
          <Route path="onboarding" element={<Onboarding />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
