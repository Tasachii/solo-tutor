import {
  attestedRows, buildHandler, mirrorUsage, normalizeUsage, serverOnlyEvents, USAGE_VERSION,
  type MirrorRow, type UsageDb, type VerifiedAccount,
} from '../../supabase/functions/usage/index.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const ORIGIN = 'https://solo.example'
// The limiter refuses a request with no trusted client address before anything else runs.
const FROM = { 'x-forwarded-for': '203.0.113.7' }
const VISITOR = '3d1f5c0a-9b2e-4c7d-8f11-6a2b3c4d5e6f'
const SESSION = '7e2a1b3c-4d5e-4f60-9a8b-1c2d3e4f5a6b'
const EVENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

const validBody = (over: Record<string, unknown> = {}) => ({
  v: USAGE_VERSION, event_id: EVENT_ID, teacher_id: VISITOR, session_id: SESSION,
  event: 'landing_view', count: 1, route: 'landing', audience: 'public', mode: null, ...over,
})

/** ฐานข้อมูลปลอมที่จำทุกแถวที่ถูกเขียน และบังคับกฎ event_id ซ้ำเหมือนดัชนีจริง */
function fakeDb() {
  const stored = new Map<string, Record<string, unknown>>()
  let rateLimited = false
  const db: UsageDb = {
    rpc: () => Promise.resolve({ data: [{ allowed: !rateLimited, retry_after: 42 }], error: null }),
    from: () => ({
      upsert: (values: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates: boolean }) => {
        if (options.onConflict !== 'event_id' || !options.ignoreDuplicates) {
          return Promise.resolve({ error: { message: 'writer must dedupe on event_id' } })
        }
        for (const row of values) if (!stored.has(String(row.event_id))) stored.set(String(row.event_id), row)
        return Promise.resolve({ error: null })
      },
    }),
  }
  return {
    db,
    rows: () => [...stored.values()],
    limit: (on: boolean) => { rateLimited = on },
  }
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://edge.example/usage', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...FROM, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const account: VerifiedAccount = {
  id: '10000000-0000-4000-8000-000000000001',
  createdAt: '2026-09-01T02:00:00.000Z',
  emailConfirmedAt: '2026-09-01T02:05:00.000Z',
}

const silentMirror = () => Promise.resolve(false)

Deno.test('only the agreed fields survive; names, emails and paths are dropped', () => {
  const row = normalizeUsage(validBody({
    child_name: 'น้องเอ', email: 'parent@example.com', phone: '0812345678',
    url: 'https://solo.example/#/document/secret', time: '2026-09-08T03:00:00.000Z',
  }))
  equal(Object.keys(row ?? {}).sort(),
    ['audience', 'count', 'event', 'event_id', 'mode', 'route', 'session_id', 'teacher_id', 'version'])
  equal(JSON.stringify(row).includes('secret'), false)
  equal(JSON.stringify(row).includes('parent@example.com'), false)
})

Deno.test('unknown, server-only and malformed values are refused', () => {
  equal(normalizeUsage(validBody({ event: 'heartbeat' })), null)
  for (const name of serverOnlyEvents) equal(normalizeUsage(validBody({ event: name })), null)
  for (const name of ['pro_requested', 'subscription_payment_verified', 'refund_verified']) {
    equal(normalizeUsage(validBody({ event: name })), null)
  }
  equal(normalizeUsage(validBody({ event_id: 'srv:signup_completed:10000000-0000-4000-8000-000000000001' })), null)
  equal(normalizeUsage(validBody({ event_id: 'not-a-uuid' })), null)
  equal(normalizeUsage(validBody({ teacher_id: '../../etc/passwd' })), null)
  equal(normalizeUsage(validBody({ session_id: 123 })), null)
  equal(normalizeUsage(validBody({ count: -1 })), null)
  equal(normalizeUsage(validBody({ count: 10_001 })), null)
  equal(normalizeUsage(validBody({ count: 1.5 })), null)
  equal(normalizeUsage(validBody({ audience: 'investors' })), null)
  equal(normalizeUsage(validBody({ v: 1 })), null)
  // route ที่ไม่อยู่ในรายการถูกทิ้งเป็น null แทนที่จะพา path จริงเข้าตาราง
  equal(normalizeUsage(validBody({ route: '/document/secret-token' }))?.route, null)
})

Deno.test('demo, real and team traffic stay on their own axes', () => {
  equal(normalizeUsage(validBody({ mode: 'demo', event: 'demo_completed' }))?.mode, 'demo')
  equal(normalizeUsage(validBody({ mode: 'real' }))?.mode, 'real')
  equal(normalizeUsage(validBody({ mode: 'paying' }))?.mode, null)
  equal(normalizeUsage(validBody({ audience: 'team' }))?.audience, 'team')
})

Deno.test('account milestones come from Auth, one row per account for all time', () => {
  const rows = attestedRows(account, { teacher_id: VISITOR, audience: 'public' })
  equal(rows.map((row) => row.event), ['signup_completed', 'email_verified'])
  equal(rows.map((row) => row.event_id), [
    `srv:signup_completed:${account.id}`, `srv:email_verified:${account.id}`,
  ])
  // เวลาที่ Auth บันทึกไว้จริง cohort จึงตรงแม้เราเพิ่งเห็นบัญชีนั้นวันนี้
  equal(rows.map((row) => row.at), [account.createdAt, account.emailConfirmedAt])
  equal(attestedRows({ ...account, emailConfirmedAt: null }, { teacher_id: VISITOR, audience: 'public' })
    .map((row) => row.event), ['signup_completed'])
  equal(attestedRows({ id: account.id, createdAt: 'not a date', emailConfirmedAt: null },
    { teacher_id: VISITOR, audience: 'public' }), [])
})

Deno.test('an anonymous visitor event is stored without an account', async () => {
  const fake = fakeDb()
  const handler = buildHandler({ db: () => fake.db, mirror: silentMirror })
  const response = await handler(post(validBody()))
  equal(response.status, 200)
  equal(fake.rows().length, 1)
  equal(fake.rows()[0].provider_id, null)
  equal(fake.rows()[0].event, 'landing_view')
})

Deno.test('the same event_id twice stores one row and still answers success', async () => {
  const fake = fakeDb()
  const handler = buildHandler({ db: () => fake.db, mirror: silentMirror })
  equal((await handler(post(validBody()))).status, 200)
  equal((await handler(post(validBody()))).status, 200)
  equal(fake.rows().length, 1)
})

Deno.test('a verified bearer attaches the account and records its Auth milestones once', async () => {
  const fake = fakeDb()
  const handler = buildHandler({
    db: () => fake.db, mirror: silentMirror,
    verify: (token) => Promise.resolve(token === 'good-token' ? account : null),
  })
  const first = await handler(post(validBody({ event: 'app_open', mode: 'real' }),
    { Authorization: 'Bearer good-token' }))
  equal(first.status, 200)
  equal(fake.rows().map((row) => row.event), ['app_open', 'signup_completed', 'email_verified'])
  equal(fake.rows().every((row) => row.provider_id === account.id), true)

  const second = await handler(post(validBody({ event_id: SESSION, event: 'app_open', mode: 'real' }),
    { Authorization: 'Bearer good-token' }))
  equal(second.status, 200)
  equal(fake.rows().length, 4)
  equal(fake.rows().filter((row) => row.event === 'signup_completed').length, 1)
})

Deno.test('a bearer that does not verify is refused instead of stored as anonymous', async () => {
  const fake = fakeDb()
  const handler = buildHandler({
    db: () => fake.db, mirror: silentMirror, verify: () => Promise.resolve(null),
  })
  const response = await handler(post(validBody(), { Authorization: 'Bearer forged' }))
  equal(response.status, 401)
  equal(fake.rows().length, 0)
})

Deno.test('unknown event names, oversized bodies and bad JSON never reach the table', async () => {
  const fake = fakeDb()
  const handler = buildHandler({ db: () => fake.db, mirror: silentMirror })
  equal((await handler(post(validBody({ event: 'subscription_payment_verified' })))).status, 400)
  equal((await handler(post('{"v":2,'))).status, 400)
  const oversized = new Request('https://edge.example/usage', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'content-length': '99999', ...FROM },
    body: JSON.stringify(validBody()),
  })
  equal((await handler(oversized)).status, 413)
  const padded = await handler(post(validBody({ route: 'app', event: 'app_open', pad: 'x'.repeat(2_000) })))
  equal(padded.status, 413)
  equal(fake.rows().length, 0)
})

Deno.test('rate limiting still guards the endpoint and other methods are refused', async () => {
  const fake = fakeDb()
  const handler = buildHandler({ db: () => fake.db, mirror: silentMirror })
  fake.limit(true)
  const limited = await handler(post(validBody()))
  equal(limited.status, 429)
  equal(limited.headers.get('retry-after'), '42')
  equal(fake.rows().length, 0)
  fake.limit(false)
  equal((await handler(new Request('https://edge.example/usage', {
    method: 'GET', headers: { Origin: ORIGIN, ...FROM },
  }))).status, 405)
})

Deno.test('a foreign or missing origin is refused before anything is stored', async () => {
  const fake = fakeDb()
  const handler = buildHandler({ db: () => fake.db, mirror: silentMirror })
  equal((await handler(new Request('https://edge.example/usage', {
    method: 'POST', headers: { Origin: 'https://evil.example', ...FROM }, body: JSON.stringify(validBody()),
  }))).status, 403)
  equal((await handler(new Request('https://edge.example/usage', {
    method: 'POST', headers: { ...FROM }, body: JSON.stringify(validBody()),
  }))).status, 403)
  equal(fake.rows().length, 0)
})

Deno.test('the Sheets mirror carries only names its receiver stores', async () => {
  const site = { url: 'https://script.google.com/macros/s/synthetic/exec', secret: 'synthetic-secret-at-least-24-chars' }
  const accept = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  const refuse = () => { throw new Error('the mirror must not be called') }
  const row = { teacher_id: VISITOR, count: 1, mode: 'real' as const }
  equal(await mirrorUsage({ ...row, event: 'invoice_issued' }, new Date(), accept as typeof fetch, site), true)
  for (const event of ['landing_view', 'demo_completed', 'signup_started', 'onboarding_completed',
                       'signup_completed', 'email_verified']) {
    equal(await mirrorUsage({ ...row, event }, new Date(), refuse as unknown as typeof fetch, site), false)
  }
})

Deno.test('only the visitor event is mirrored, never the account milestones', async () => {
  const fake = fakeDb()
  const mirrored: MirrorRow[] = []
  const handler = buildHandler({
    db: () => fake.db,
    verify: () => Promise.resolve(account),
    mirror: (row) => { mirrored.push(row); return Promise.resolve(true) },
  })
  await handler(post(validBody({ event: 'app_open', mode: 'real' }), { Authorization: 'Bearer good-token' }))
  equal(mirrored.map((row) => row.event), ['app_open'])
})
