import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useStore } from './core/store'
import StorageStatus from './app/StorageStatus'
import { sendUsage } from './core/usage'

import Landing from './platform/Landing'
import Pricing from './platform/Pricing'
import StylePicker from './platform/StylePicker'
import AppShell from './app/AppShell'
import Today from './app/Today'
import Subjects from './app/Subjects'
import SubjectDetail from './app/SubjectDetail'
import Billing from './app/Billing'
import Admin from './app/Admin'
import ReceiptList from './app/ReceiptList'
import Onboarding from './app/Onboarding'
import Receipt from './app/Receipt'
import ClientPreview from './app/ClientPreview'
import LineSettings from './app/LineSettings'
import Account from './app/Account'
import { CloudSyncProvider } from './app/CloudSync'
import Legal from './platform/Legal'

export default function App() {
  const { state, didReset, track } = useStore()

  useEffect(() => { track('app_open'); sendUsage('app_open', 1, state.mode) }, [track]) // eslint-disable-line react-hooks/exhaustive-deps

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
  if (didReset) return <StorageStatus />

  return (
    <><StorageStatus /><Routes>
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
        <Route path="receipts" element={<ReceiptList />} />
        <Route path="onboarding" element={<Onboarding />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></>
  )
}
