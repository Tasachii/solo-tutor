/** Connect the authenticated provider's LINE OA. */
import { admin, jsonBody, jsonError, ok, requireEnv, requireUserId, seal, serveErrors, withCors } from '../_shared/db.ts'

interface ConnectInput { providerId: string; channelSecret: string; accessToken: string }

interface ConnectSetupDeps {
  fetch: typeof fetch
  seal: typeof seal
  persistPending: (row: Record<string, unknown>) => Promise<void>
  setStatus: (providerId: string, status: 'active' | 'setup_failed', verifiedAt?: string) => Promise<void>
}

export async function authenticatedConnectInput(
  req: Request,
  deps: { userId: typeof requireUserId; body: typeof jsonBody } = { userId: requireUserId, body: jsonBody },
): Promise<ConnectInput | Response> {
  const providerId = await deps.userId(req)
  const body = await deps.body(req)
  const channelSecret = typeof body.channelSecret === 'string' ? body.channelSecret.trim() : ''
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : ''
  if (!channelSecret || !accessToken) return jsonError(400, 'missing-credentials')
  return { providerId, channelSecret, accessToken }
}

export async function configureLineChannel(
  input: ConnectInput,
  webhookUrl: string,
  deps: ConnectSetupDeps,
): Promise<Response> {
  const { providerId, channelSecret, accessToken } = input
  const auth = { Authorization: `Bearer ${accessToken}` }
  const info = await deps.fetch('https://api.line.me/v2/bot/info', {
    headers: auth, signal: AbortSignal.timeout(10_000),
  })
  if (!info.ok) return jsonError(400, 'token')
  const bot = await info.json() as { userId?: unknown; basicId?: unknown; displayName?: unknown }
  if (typeof bot.userId !== 'string' || !bot.userId) return jsonError(502, 'line-response')
  const displayName = typeof bot.displayName === 'string' ? bot.displayName : null
  const basicId = typeof bot.basicId === 'string' ? bot.basicId : null

  // Persist encrypted credentials in a non-deliverable state before mutating LINE configuration.
  await deps.persistPending({
    provider_id: providerId,
    bot_user_id: bot.userId,
    basic_id: basicId,
    channel_secret: await deps.seal(channelSecret),
    access_token: await deps.seal(accessToken),
    display_name: displayName,
    status: 'pending',
    last_verified_at: null,
  })

  try {
    const endpoint = await deps.fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: webhookUrl }), signal: AbortSignal.timeout(10_000),
    })
    if (!endpoint.ok) {
      await deps.setStatus(providerId, 'setup_failed')
      return jsonError(502, 'webhook')
    }
    const test = await deps.fetch('https://api.line.me/v2/bot/channel/webhook/test', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: webhookUrl }), signal: AbortSignal.timeout(10_000),
    })
    const testResult = await test.json().catch(() => null) as { success?: unknown } | null
    if (!test.ok || testResult?.success !== true) {
      await deps.setStatus(providerId, 'setup_failed')
      return jsonError(502, 'webhook')
    }
  } catch (error) {
    await deps.setStatus(providerId, 'setup_failed')
    throw error
  }
  await deps.setStatus(providerId, 'active', new Date().toISOString())
  return ok({ ok: true, displayName, basicId })
}

export const handler = withCors(serveErrors(async (req) => {
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
  const input = await authenticatedConnectInput(req)
  if (input instanceof Response) return input
  // The callback is server configuration, not a caller-selected URL.
  const webhookUrl = requireEnv('LINE_WEBHOOK_URL')
  const parsedWebhookUrl = new URL(webhookUrl)
  if (parsedWebhookUrl.protocol !== 'https:') return jsonError(500, 'server-configuration')
  const db = admin()
  return configureLineChannel(input, webhookUrl, {
    fetch,
    seal,
    persistPending: async (row) => {
      const { error } = await db.rpc('replace_line_channel', {
        p_provider_id: row.provider_id,
        p_bot_user_id: row.bot_user_id,
        p_basic_id: row.basic_id,
        p_channel_secret: row.channel_secret,
        p_access_token: row.access_token,
        p_display_name: row.display_name,
      })
      if (error) throw error
    },
    setStatus: async (providerId, status, verifiedAt) => {
      const changes: Record<string, unknown> = { status }
      if (verifiedAt) changes.last_verified_at = verifiedAt
      changes.updated_at = new Date().toISOString()
      const { error } = await db.from('line_channels').update(changes).eq('provider_id', providerId)
      if (error) throw error
    },
  })
}))

if (import.meta.main) Deno.serve(handler)
