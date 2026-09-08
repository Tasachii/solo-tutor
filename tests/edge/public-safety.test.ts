import { enforcePublicRateLimit, jsonBody, optionalUserId, withCors } from '../../supabase/functions/_shared/db.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test('required CORS rejects missing and foreign origins before the handler', async () => {
  let calls = 0
  const handler = withCors(async () => {
    calls += 1
    return new Response('ok')
  }, () => 'https://solo.example/path', true)

  equal((await handler(new Request('https://edge.example', { method: 'POST' }))).status, 403)
  equal((await handler(new Request('https://edge.example', {
    method: 'POST', headers: { Origin: 'https://evil.example' },
  }))).status, 403)
  const accepted = await handler(new Request('https://edge.example', {
    method: 'POST', headers: { Origin: 'https://solo.example' },
  }))
  equal(accepted.status, 200)
  equal(accepted.headers.get('access-control-allow-origin'), 'https://solo.example')
  equal(calls, 1)
})

Deno.test('optional CORS still permits origin-less cron and webhook-style requests', async () => {
  const handler = withCors(async () => new Response('ok'), () => 'https://solo.example')
  equal((await handler(new Request('https://edge.example', { method: 'POST' }))).status, 200)
})

Deno.test('jsonBody enforces declared and streamed byte limits', async () => {
  const declared = new Request('https://edge.example', {
    method: 'POST', headers: { 'content-length': '101' }, body: '{}',
  })
  try {
    await jsonBody(declared, 100)
    throw new Error('declared oversized body was accepted')
  } catch (error) {
    equal(error instanceof Response ? error.status : null, 413)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'))
      controller.enqueue(new TextEncoder().encode('x'.repeat(100)))
      controller.enqueue(new TextEncoder().encode('"}'))
      controller.close()
    },
  })
  try {
    await jsonBody(new Request('https://edge.example', { method: 'POST', body: stream }), 64)
    throw new Error('streamed oversized body was accepted')
  } catch (error) {
    equal(error instanceof Response ? error.status : null, 413)
  }

  equal(await jsonBody(new Request('https://edge.example', { method: 'POST', body: '{"ok":true}' }), 64), { ok: true })
})

Deno.test('rate limiter sends only a pseudonymous hash and returns Retry-After', async () => {
  let rpcArgs: Record<string, unknown> | null = null
  const db = {
    rpc: (_name: string, args: Record<string, unknown>) => {
      rpcArgs = args
      return Promise.resolve({ data: [{ allowed: false, retry_after: 37 }], error: null })
    },
  }
  const response = await enforcePublicRateLimit(new Request('https://edge.example', {
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
  }), 'waitlist', { client: 5, global: 200, windowSeconds: 600 }, db)
  equal(response?.status, 429)
  equal(response?.headers.get('retry-after'), '37')
  const hash = (rpcArgs as Record<string, unknown> | null)?.['p_client_hash']
  equal(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) && !hash.includes('203.0.113.7'), true)
})

Deno.test('optional usage identity verifies every supplied bearer and ignores anonymous requests', async () => {
  let calls = 0
  const verify = async () => {
    calls += 1
    return '10000000-0000-0000-0000-000000000001'
  }
  equal(await optionalUserId(new Request('https://edge.example'), verify), null)
  equal(calls, 0)
  equal(await optionalUserId(new Request('https://edge.example', {
    headers: { Authorization: 'Bearer verified-by-auth' },
  }), verify), '10000000-0000-0000-0000-000000000001')
  equal(calls, 1)
})
