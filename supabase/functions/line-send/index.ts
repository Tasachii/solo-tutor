/** Atomically claim and deliver LINE outbox rows. Intentionally undeployed. */
import { classifyPush, nextSendWindow, pushRequest, retryDelayMs, withinSendWindow } from '../../../src/core/lineProtocol.ts'
import { authorizeLineSend, chooseChannel } from '../../../src/core/lineDelivery.ts'
import { admin, isCronRequest, jsonBody, jsonError, ok, open, requireUserId, serveErrors, withCors } from '../_shared/db.ts'

interface ClaimedRow {
  id: string
  recipient_id: string
  body: string
  attempts: number
  retry_key: string
  claim_token: string
  line_user_id: string
  client_id: string | null
  unfollowed_at: string | null
}

type ChannelRow = {
  status: 'pending' | 'active' | 'setup_failed' | 'invalid' | 'disabled'
  quota_used: number
  quota_limit: number
}

/** A returned claim already owns DB-reserved quota; only recipient/token state remains to check. */
export function chooseClaimedDelivery(
  channel: ChannelRow,
  row: Pick<ClaimedRow, 'client_id' | 'unfollowed_at'>,
  auto: boolean,
  tokenInvalid: boolean,
) {
  return chooseChannel(
    {
      status: tokenInvalid ? 'invalid' : channel.status,
      quotaUsed: 0,
      quotaLimit: 1,
    },
    { linked: !!row.client_id, unfollowed: !!row.unfollowed_at },
    { auto },
  )
}

export async function authenticatedSendAuthority(
  req: Request,
  body: Record<string, unknown>,
  deps: { cron: typeof isCronRequest; userId: typeof requireUserId } = {
    cron: isCronRequest, userId: requireUserId,
  },
) {
  const hasCronHeader = req.headers.has('x-cron-secret')
  const cron = hasCronHeader && deps.cron(req)
  const verifiedUserId = hasCronHeader ? undefined : await deps.userId(req)
  return authorizeLineSend({
    hasCronHeader,
    cronSecretValid: cron,
    verifiedUserId,
    requestedProviderId: typeof body.providerId === 'string' ? body.providerId : undefined,
  })
}

export function interactiveOutboxId(body: Record<string, unknown>): string | null {
  const value = typeof body.outboxId === 'string' ? body.outboxId.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

/** LINE limits text by UTF-16 code units; reject instead of silently slicing the audited body. */
export function claimedBodyIssue(body: string): string | null {
  return body.trim().length === 0 || body.length > 5000 ? 'invalid-body' : null
}

export const handler = withCors(serveErrors(async (req) => {
  if (req.method !== 'POST') return jsonError(405, 'method-not-allowed')
  const body = await jsonBody(req)
  const authority = await authenticatedSendAuthority(req, body)
  if (!authority.ok) return jsonError(401, 'unauthorized')
  const targetOutboxId = authority.mode === 'interactive' ? interactiveOutboxId(body) : null
  if (authority.mode === 'interactive' && !targetOutboxId) {
    return jsonError(400, 'missing-outbox-id')
  }

  const db = admin()
  let providerIds: string[]
  if (authority.mode === 'cron') {
    const requested = authority.providerId
    if (requested) providerIds = [requested]
    else {
      const { data, error } = await db.from('line_channels').select('provider_id').eq('status', 'active')
      if (error) throw error
      providerIds = (data ?? []).map((row) => row.provider_id)
    }
  } else {
    // Interactive sends always derive tenant identity from a verified JWT and cannot enable auto mode.
    providerIds = [authority.providerId]
  }

  let sent = 0
  for (const providerId of providerIds) {
    const { data: channel, error: channelError } = await db.from('line_channels')
      .select('access_token, status, quota_used, quota_limit, quota_month')
      .eq('provider_id', providerId).maybeSingle()
    if (channelError) throw channelError
    if (!channel) continue

    const now = new Date()
    const auto = authority.auto
    if (auto && !withinSendWindow(now)) {
      const { error } = await db.from('message_outbox')
        .update({ scheduled_at: nextSendWindow(now).toISOString() })
        .eq('provider_id', providerId).eq('status', 'queued').lte('scheduled_at', now.toISOString())
      if (error) throw error
      continue
    }

    const { data: claimed, error: claimError } = await db.rpc('claim_line_outbox', {
      p_provider_id: providerId,
      p_limit: targetOutboxId ? 1 : 20,
      p_auto: auto,
      p_outbox_id: targetOutboxId,
    })
    if (claimError) throw claimError
    const queue = (claimed ?? []) as ClaimedRow[]
    if (queue.length === 0) continue
    if (typeof channel.access_token !== 'string' || !channel.access_token) {
      throw new Error('Active LINE channel has no access token')
    }
    const token = await open(channel.access_token)
    let tokenInvalid = channel.status === 'invalid'

    const finish = async (row: ClaimedRow, outcome: string, error: string | null = null, retryAt: Date | null = null) => {
      const { data, error: finishError } = await db.rpc('finish_line_outbox', {
        p_provider_id: providerId,
        p_id: row.id,
        p_claim_token: row.claim_token,
        p_outcome: outcome,
        p_error: error,
        p_retry_at: retryAt?.toISOString() ?? null,
      })
      if (finishError) throw finishError
      if (data !== true) throw new Error('Outbox claim was lost before settlement')
    }

    for (const row of queue) {
      const bodyIssue = claimedBodyIssue(row.body)
      if (bodyIssue) {
        await finish(row, 'failed', bodyIssue)
        continue
      }
      const choice = chooseClaimedDelivery(channel as ChannelRow, row, auto, tokenInvalid)
      if (choice.channel !== 'oa') {
        await finish(row, 'skipped', choice.reason)
        continue
      }

      let response: Response
      try {
        const request = pushRequest(token, row.line_user_id, row.body, row.retry_key)
        response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(10_000) })
      } catch {
        const delay = retryDelayMs(row.attempts + 1)
        await finish(row, delay === null ? 'failed' : 'retry', 'network',
          delay === null ? null : new Date(now.getTime() + delay))
        continue
      }
      const outcome = classifyPush(response.status, await response.text().catch(() => ''))
      if (outcome === 'sent') {
        await finish(row, 'sent')
        sent += 1
      } else if (outcome === 'retry') {
        const delay = retryDelayMs(row.attempts + 1)
        await finish(row, delay === null ? 'failed' : 'retry',
          delay === null ? 'retry-exhausted' : 'retryable',
          delay === null ? null : new Date(now.getTime() + delay))
      } else if (outcome === 'invalid-token') {
        await finish(row, 'invalid-token', 'invalid-token')
        tokenInvalid = true
      } else {
        await finish(row, outcome, outcome)
      }
    }
  }
  if (authority.mode === 'interactive') {
    const { data: row, error } = await db.from('message_outbox').select('status')
      .eq('provider_id', authority.providerId).eq('id', targetOutboxId!).maybeSingle()
    if (error) throw error
    if (!row) return jsonError(404, 'outbox-not-found')
    return ok({ ok: true, outboxId: targetOutboxId, status: row.status })
  }
  return ok({ ok: true, sent })
}))

if (import.meta.main) Deno.serve(handler)
