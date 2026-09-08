import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.SOLO_QA_PORT ?? 4173)
const baseURL = `http://localhost:${port}/solo-tutor/`

/** เทสวิ่งกับ build จริงเสมอ ไม่ใช่ dev server — เพราะสิ่งที่คนเห็นคือ dist */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [[process.env.CI ? 'line' : 'list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    timezoneId: 'Asia/Bangkok',
    // Mock API requests must reach Playwright routing, including on WebKit.
    serviceWorkers: process.env.SOLO_LINE_QA === '1' ? 'block' : 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    ...(process.env.SOLO_CROSS_BROWSER === '1'
      ? [{ name: 'webkit', use: { ...devices['iPhone 13'] } }] : []),
  ],
  webServer: {
    // Never let the default suite inherit a real project from .env.local.
    // The separate mock command supplies its own intercepted API configuration.
    env: process.env.SOLO_LINE_QA === '1' ? undefined : {
      VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_ANON_KEY: '',
      VITE_SUPPORT_CONTACT: '', VITE_PROVIDER_LEGAL_NAME: '', VITE_SOLO_PROMPTPAY: '',
    },
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
