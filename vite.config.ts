import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base ต้องตรงชื่อ repo บน GitHub Pages (repo: solo-tutor)
export default defineConfig({
  plugins: [react()],
  base: '/solo-tutor/',
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // ผู้ใช้อยู่ไทย (UTC+7) — รันเทสใน UTC จะมองไม่เห็นบั๊ก
    // ที่ 00:30 ตามเครื่องกลายเป็นเมื่อวานถ้าเผลอใช้ toISOString
    env: { TZ: 'Asia/Bangkok' },
  },
} as never)
