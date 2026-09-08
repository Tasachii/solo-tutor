import { lazy, Suspense, useEffect, useRef } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useStore } from './core/store'
import { sendUsage } from './core/usage'

import Landing from './platform/Landing'
import { CloudSyncProvider } from './app/CloudSync'

const Pricing = lazy(() => import('./platform/Pricing'))
const StylePicker = lazy(() => import('./platform/StylePicker'))
const Legal = lazy(() => import('./platform/Legal'))
const AppShell = lazy(() => import('./app/AppShell'))
const Today = lazy(() => import('./app/Today'))
const Subjects = lazy(() => import('./app/Subjects'))
const SubjectDetail = lazy(() => import('./app/SubjectDetail'))
const Billing = lazy(() => import('./app/Billing'))
const Admin = lazy(() => import('./app/Admin'))
const ReceiptList = lazy(() => import('./app/ReceiptList'))
const Onboarding = lazy(() => import('./app/Onboarding'))
const Receipt = lazy(() => import('./app/Receipt'))
const ClientPreview = lazy(() => import('./app/ClientPreview'))
const LineSettings = lazy(() => import('./app/LineSettings'))
const Account = lazy(() => import('./app/Account'))
const Help = lazy(() => import('./app/Help'))

function RouteLoading() {
  return <main className="pane" role="status" aria-live="polite" aria-busy="true">
    <p>กำลังเปิดหน้า…</p>
  </main>
}

export default function App() {
  const { state, track } = useStore()
  const initialMode = useRef(state.mode)

  useEffect(() => { track('app_open'); sendUsage('app_open', 1, initialMode.current) }, [track])

  // ตัวนับ 4 เหตุการณ์สำหรับทีม — ดูจากความยาวรายการที่เปลี่ยน ไม่ต้องแตะ reducer
  const seen = useRef({ subjects: state.subjects.length, invoices: state.invoices.length, payments: state.payments.length })
  useEffect(() => {
    const prev = seen.current
    const next = { subjects: state.subjects.length, invoices: state.invoices.length, payments: state.payments.length }
    if (next.subjects !== prev.subjects) sendUsage('students_changed', next.subjects, state.mode)
    if (next.invoices > prev.invoices) sendUsage('invoice_issued', next.invoices - prev.invoices, state.mode)
    if (next.payments > prev.payments) sendUsage('payment_recorded', next.payments - prev.payments, state.mode)
    seen.current = next
  }, [state.subjects.length, state.invoices.length, state.payments.length, state.mode])
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/start" element={<StylePicker />} />
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
