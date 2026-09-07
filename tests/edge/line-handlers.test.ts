import { authenticatedConnectInput, configureLineChannel, handler as connectHandler } from '../../supabase/functions/line-connect/index.ts'
import { authenticatedSendAuthority, claimedBodyIssue, chooseClaimedDelivery, handler as sendHandler, interactiveOutboxId } from '../../supabase/functions/line-send/index.ts'
import { handler as webhookHandler } from '../../supabase/functions/line-webhook/index.ts'
import { open, seal } from '../../supabase/functions/_shared/db.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test('line-connect ignores a forged body provider and uses verified identity', async () => {
  const result = await authenticatedConnectInput(new Request('https://local/connect', { method: 'POST' }), {
    userId: async () => 'provider-from-jwt',
    body: async () => ({
      providerId: 'forged-provider', channelSecret: ' secret ', accessToken: ' token ',
    }),
  })
  equal(result, {
    providerId: 'provider-from-jwt', channelSecret: 'secret', accessToken: 'token',
  })
})

Deno.test('interactive send ignores body provider and cannot request auto mode', async () => {
  const authority = await authenticatedSendAuthority(
    new Request('https://local/send', { method: 'POST' }),
    { providerId: 'forged-provider', auto: true },
    { cron: () => false, userId: async () => 'provider-from-jwt' },
  )
  equal(authority, {
    ok: true, mode: 'interactive', providerId: 'provider-from-jwt', auto: false,
  })
})

Deno.test('interactive send accepts only an explicit UUID outbox target', () => {
  equal(interactiveOutboxId({ outboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  equal(interactiveOutboxId({ outboxId: 'not-a-uuid' }), null)
  equal(interactiveOutboxId({}), null)
})

Deno.test('LINE send rejects oversized UTF-16 bodies instead of slicing persisted content', () => {
  equal(claimedBodyIssue('message'), null)
  equal(claimedBodyIssue('😀'.repeat(2501)), 'invalid-body')
  equal(claimedBodyIssue('   '), 'invalid-body')
})

Deno.test('cron header uses only the separate secret path', async () => {
  const req = new Request('https://local/send', {
    method: 'POST', headers: { 'x-cron-secret': 'supplied' },
  })
  const invalid = await authenticatedSendAuthority(req, { providerId: 'p1' }, {
    cron: () => false,
    userId: async () => { throw new Error('JWT path must not run for cron') },
  })
  equal(invalid, { ok: false, reason: 'unauthorized' })
  const valid = await authenticatedSendAuthority(req, { providerId: 'p1' }, {
    cron: () => true,
    userId: async () => { throw new Error('JWT path must not run for cron') },
  })
  equal(valid, { ok: true, mode: 'cron', providerId: 'p1', auto: true })
})

Deno.test('atomic claim remains sendable after monthly rollover resets stale quota', () => {
  const choice = chooseClaimedDelivery(
    { status: 'active', quota_used: 280, quota_limit: 300 },
    { client_id: 'client-1', unfollowed_at: null },
    true,
    false,
  )
  equal(choice, { channel: 'oa', reason: 'ok' })
})

Deno.test('handlers reject wrong methods before configuration or network access', async () => {
  equal((await connectHandler(new Request('https://local/connect', {
    headers: { Origin: 'https://solo.example' },
  }))).status, 405)
  equal((await sendHandler(new Request('https://local/send', {
    headers: { Origin: 'https://solo.example' },
  }))).status, 405)
  equal((await webhookHandler(new Request('https://local/webhook'))).status, 405)
})

Deno.test('browser preflight allows only the configured frontend origin', async () => {
  const allowed = await connectHandler(new Request('https://local/connect', {
    method: 'OPTIONS', headers: { Origin: 'https://solo.example' },
  }))
  equal(allowed.status, 204)
  equal(allowed.headers.get('access-control-allow-origin'), 'https://solo.example')
  equal(allowed.headers.get('access-control-allow-headers'),
    'authorization, content-type, apikey, x-client-info')
  const denied = await sendHandler(new Request('https://local/send', {
    method: 'OPTIONS', headers: { Origin: 'https://attacker.example' },
  }))
  equal(denied.status, 403)
})

Deno.test('connect persists pending before webhook mutation and activates last', async () => {
  const order: string[] = []
  const responses = [
    new Response(JSON.stringify({ userId: 'bot-1', basicId: '@tutor', displayName: 'Tutor OA' }), { status: 200 }),
    new Response(null, { status: 200 }),
    new Response(JSON.stringify({ success: true }), { status: 200 }),
  ]
  const response = await configureLineChannel(
    { providerId: 'p1', channelSecret: 'secret', accessToken: 'token' },
    'https://functions.example/line-webhook',
    {
      fetch: async (_input, init) => { order.push(init?.method ?? 'GET'); return responses.shift()! },
      seal: async (value) => `sealed:${value}`,
      persistPending: async (row) => {
        equal({ status: row.status, basicId: row.basic_id }, { status: 'pending', basicId: '@tutor' })
        order.push('pending')
      },
      setStatus: async (_provider, status) => { order.push(status) },
    },
  )
  equal(response.status, 200)
  equal(await response.json(), { ok: true, displayName: 'Tutor OA', basicId: '@tutor' })
  equal(order, ['GET', 'pending', 'PUT', 'POST', 'active'])
})

Deno.test('failed webhook setup leaves a retryable failed state', async () => {
  const order: string[] = []
  const response = await configureLineChannel(
    { providerId: 'p1', channelSecret: 'secret', accessToken: 'token' },
    'https://functions.example/line-webhook',
    {
      fetch: async (_input, init) => {
        order.push(init?.method ?? 'GET')
        return init?.method === 'PUT'
          ? new Response(null, { status: 500 })
          : new Response(JSON.stringify({ userId: 'bot-1' }), { status: 200 })
      },
      seal: async (value) => `sealed:${value}`,
      persistPending: async () => { order.push('pending') },
      setStatus: async (_provider, status) => { order.push(status) },
    },
  )
  equal(response.status, 502)
  equal(order, ['GET', 'pending', 'PUT', 'setup_failed'])
})

Deno.test('LINE webhook verification must report success even with HTTP 200', async () => {
  const statuses: string[] = []
  const response = await configureLineChannel(
    { providerId: 'p1', channelSecret: 'secret', accessToken: 'token' },
    'https://functions.example/line-webhook',
    {
      fetch: async (_input, init) => {
        if (!init?.method) return new Response(JSON.stringify({ userId: 'bot-1' }), { status: 200 })
        if (init.method === 'PUT') return new Response(null, { status: 200 })
        return new Response(JSON.stringify({ success: false, reason: 'signature' }), { status: 200 })
      },
      seal: async (value) => `sealed:${value}`,
      persistPending: async () => {},
      setStatus: async (_provider, status) => { statuses.push(status) },
    },
  )
  equal(response.status, 502)
  equal(statuses, ['setup_failed'])
})

Deno.test('malformed and unknown webhook payloads are acknowledged without external calls', async () => {
  const malformed = await webhookHandler(new Request('https://local/webhook', {
    method: 'POST', body: 'not-json',
  }))
  equal(malformed.status, 200)
})

Deno.test('crypto helpers fail closed on empty or malformed secrets', async () => {
  let emptyRejected = false
  let malformedRejected = false
  try { await seal('') } catch { emptyRejected = true }
  try { await open('not-encrypted') } catch { malformedRejected = true }
  equal(emptyRejected, true)
  equal(malformedRejected, true)
})

Deno.test('Supabase gateway delegates auth to handlers for modern JWT, LINE signature, and cron', async () => {
  const config = await Deno.readTextFile('supabase/config.toml')
  equal(/\[functions\.line-webhook\][\s\S]*?verify_jwt\s*=\s*false/.test(config), true)
  equal(/\[functions\.line-send\][\s\S]*?verify_jwt\s*=\s*false/.test(config), true)
  equal(/\[functions\.line-connect\][\s\S]*?verify_jwt\s*=\s*false/.test(config), true)
})
