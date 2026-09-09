import React from 'react'
import { watchServiceWorkerUpdates } from './app/swUpdate'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { applyTheme, readTheme } from './core/theme'
import { applySize, readSize } from './core/display'
import { applyAccent, readAccent } from './core/accent'
import { applyFrame, readFrame } from './core/present'
import App from './App'
import SharedDocument from './app/SharedDocument'
import ErrorBoundary from './app/ErrorBoundary'
import { StoreProvider } from './core/store'
import { ToastProvider } from './app/components/Toast'
import './index.css'
import { installErrorMonitoring } from './core/errorReport'

if (window.top === window.self) {
  const stopMonitoring = installErrorMonitoring()
  import.meta.hot?.dispose(stopMonitoring)
}

applyTheme(readTheme())
applySize(readSize())
applyAccent(readAccent())
applyFrame(readFrame())

// sw.js อยู่ใน public/ มาตั้งแต่ต้นแต่ไม่เคยถูกลงทะเบียน — เปิดออฟไลน์ไม่ได้ และเวอร์ชันแคชไม่เคยทำงาน
// ลงทะเบียนเฉพาะ build จริง: ตอน dev ตัว SW จะแคช module ของ Vite จนแก้โค้ดแล้วไม่เห็นผล
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => watchServiceWorkerUpdates(registration))
      .catch(() => {
        /* บางเบราว์เซอร์/โหมดส่วนตัวไม่ให้ — แอปยังใช้ได้ แค่ไม่มีออฟไลน์ */
      })
  })
}

createRoot(document.getElementById('root')!).render(
  // A Pages deployment cannot set frame-ancestors. Refuse to render account data
  // inside a frame; the production hosting header remains the stronger boundary.
  window.top !== window.self
    ? <main className="pane"><h1 className="h1">เปิด Solo Tutor ในหน้าต่างหลัก</h1>
        <p>เปิดลิงก์นี้โดยตรงเพื่อดูเอกสารหรือใช้งานบัญชีของคุณ</p>
        <a className="btn btn--primary" href={window.location.href} target="_top">เปิดหน้าต่างหลัก</a>
      </main>
    : <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/document/:token" element={<SharedDocument />} />
        <Route path="*" element={
      <StoreProvider>
        <ToastProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ToastProvider>
      </StoreProvider>
        } />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
)
