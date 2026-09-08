import { Suspense, useEffect, useRef } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useStore } from './core/store'
import { lazyRoute } from './core/lazyRoute'
import { sendUsage } from './core/usage'

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
  const initialMode = useRef(state.mode)

  useEffect(() => { track('app_open'); sendUsage('app_open', 1, initialMode.current) }, [track])

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
    if (next.subjects !== prev.subjects) sendUsage('students_changed', next.subjects, state.mode)
    if (next.invoices > prev.invoices) sendUsage('invoice_issued', next.invoices - prev.invoices, state.mode)
    if (next.payments > prev.payments) sendUsage('payment_recorded', next.payments - prev.payments, state.mode)
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
