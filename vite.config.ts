import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { basePath, siteSafety } from './build/siteSafety'

// base ต้องตรงชื่อ repo บน GitHub Pages (repo: solo-tutor)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
  plugins: [react(), siteSafety(env.VITE_SUPABASE_URL ?? '')],
  base: basePath(env.VITE_BASE_PATH),
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // ผู้ใช้อยู่ไทย (UTC+7) — รันเทสใน UTC จะมองไม่เห็นบั๊ก
    // ที่ 00:30 ตามเครื่องกลายเป็นเมื่อวานถ้าเผลอใช้ toISOString
    // Local .env.local may point at the real project. Unit tests start offline;
    // individual tests may explicitly stub synthetic settings when required.
    env: { TZ: 'Asia/Bangkok', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: '', VITE_SUPPORT_CONTACT: '', VITE_PROVIDER_LEGAL_NAME: '', VITE_SOLO_PROMPTPAY: '' },
  },
  }
})
