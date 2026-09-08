import { spawnSync } from 'node:child_process'

// Synthetic credentials and service details for isolated browser tests only.
// Every Supabase request must be intercepted by the fixture; no live project is used.
const extra = process.argv.slice(2)
const result = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test',
  ...(extra.length ? extra : ['tests/e2e/account.spec.ts', 'tests/e2e/line-oa.spec.ts']),
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SOLO_LINE_QA: '1',
    VITE_SUPABASE_URL: 'https://line-qa.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_qa',
    VITE_SUPABASE_ANON_KEY: '',
    VITE_SUPPORT_CONTACT: 'https://support.solo-tutor.test',
    VITE_PROVIDER_LEGAL_NAME: 'Solo Tutor QA (ข้อมูลสมมติ)',
    VITE_SOLO_PROMPTPAY: '0812345678',
  },
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
