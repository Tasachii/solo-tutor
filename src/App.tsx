import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useStore } from './core/store'
import StorageStatus from './app/StorageStatus'

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
import Legal from './platform/Legal'

export default function App() {
  const { didReset, track } = useStore()

  useEffect(() => { track('app_open') }, [track])
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
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/today" replace />} />
        <Route path="today" element={<Today />} />
        <Route path="subjects" element={<Subjects />} />
        <Route path="subjects/:id" element={<SubjectDetail />} />
        <Route path="billing" element={<Billing />} />
        <Route path="admin" element={<Admin />} />
        <Route path="settings/line" element={<LineSettings />} />
        <Route path="receipts" element={<ReceiptList />} />
        <Route path="onboarding" element={<Onboarding />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></>
  )
}
