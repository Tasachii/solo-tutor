import { admin, enforcePublicRateLimit, jsonBody, jsonError, ok, serveErrors, withCors } from '../_shared/db.ts'

interface User { id: string; email: string }
export interface DeletionServices {
  limit(req: Request): Promise<Response | null>
  user(token: string): Promise<User | null>
  reauthenticate(email: string, password: string): Promise<string | null>
  remove(id: string): Promise<void>
}

// A separate Auth client prevents password reauthentication from replacing the
// service-role session used to delete the account. Never accept an ID from JSON.
const services: DeletionServices = {
  limit: (req) => enforcePublicRateLimit(req, 'delete-account', { client: 5, global: 200, windowSeconds: 600 }),
  async user(token) {
    const { data, error } = await admin().auth.getUser(token)
    return !error && data.user?.email ? { id: data.user.id, email: data.user.email } : null
  },
  async reauthenticate(email, password) {
    const { data, error } = await admin().auth.signInWithPassword({ email, password })
    return !error ? data.user?.id ?? null : null
  },
  async remove(id) {
    const { error } = await admin().auth.admin.deleteUser(id)
    if (error) throw error
  },
}

export const createHandler = (deps: DeletionServices = services) => serveErrors(withCors(async (req) => {
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!bearer) return jsonError(401, 'unauthorized')
  const limited = await deps.limit(req)
  if (limited) return limited
  const user = await deps.user(bearer)
  if (!user) return jsonError(401, 'unauthorized')
  const body = await jsonBody(req, 4_096)
  if (body.confirmation !== 'DELETE' || typeof body.password !== 'string'
    || !body.password || body.password.length > 1_024) return jsonError(400, 'confirmation-required')
  if (await deps.reauthenticate(user.email, body.password) !== user.id) return jsonError(401, 'reauthentication-failed')
  await deps.remove(user.id)
  return ok()
}, undefined, true))

export const handler = createHandler()
if (import.meta.main) Deno.serve(handler)
