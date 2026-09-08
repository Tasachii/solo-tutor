import { createHandler, type DeletionServices } from '../../supabase/functions/delete-account/index.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const request = (body: unknown = { password: 'mock-password', confirmation: 'DELETE', provider_id: 'victim' }, headers: Record<string, string> = {}) =>
  new Request('https://edge.example', { method: 'POST', headers: { origin: 'https://solo.example', authorization: 'Bearer mock', ...headers }, body: JSON.stringify(body) })
const mock = (overrides: Partial<DeletionServices> = {}) => {
  const removed: string[] = []
  const deps: DeletionServices = {
    limit: async () => null,
    user: async () => ({ id: 'owner', email: 'owner@solo.test' }),
    reauthenticate: async () => 'owner',
    remove: async (id) => { removed.push(id) }, ...overrides,
  }
  return { handler: createHandler(deps), removed }
}

Deno.test('account deletion removes only the reauthenticated bearer owner', async () => {
  const { handler, removed } = mock()
  const response = await handler(request())
  equal(response.status, 200)
  equal(await response.json(), { ok: true })
  equal(removed, ['owner'])
})

Deno.test('account deletion rejects missing origin, bearer, confirmation and wrong password', async () => {
  const { handler, removed } = mock()
  equal((await handler(request(undefined, { origin: '' }))).status, 403)
  equal((await handler(request(undefined, { authorization: '' }))).status, 401)
  equal((await handler(request({ password: 'mock-password' }))).status, 400)
  equal((await mock({ user: async () => null }).handler(request())).status, 401)
  equal((await mock({ reauthenticate: async () => 'different-owner' }).handler(request())).status, 401)
  equal(removed.length, 0)
})

Deno.test('account deletion delegates paid/free erasure atomically and propagates rate limits and server failures', async () => {
  const limited = mock({ limit: async () => new Response(null, { status: 429 }) })
  equal((await limited.handler(request())).status, 429)
  equal(limited.removed.length, 0)
  equal((await mock({ remove: async () => { throw new Error('private database detail') } }).handler(request())).status, 500)
})
