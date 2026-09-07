/** Verify and persist LINE webhook events. Intentionally undeployed. */
import { verifyLineSignature } from '../../../src/core/lineDelivery.ts'
import { parseWebhook, planWebhookEvent, replyRequest } from '../../../src/core/lineProtocol.ts'
import { admin, ok, open, serveErrors } from '../_shared/db.ts'

const REPLIES = {
  'ask-code': 'สวัสดีค่ะ ห้องนี้ใช้ส่งบิลและสรุปการเรียนจากครู — พิมพ์รหัส 6 หลักที่ได้รับจากครูเพื่อเชื่อมข้อมูลได้เลยค่ะ การพิมพ์รหัสถือว่ายินยอมให้เก็บ LINE id ไว้รับบิลจากครูคนนี้ พิมพ์ "หยุด" ได้ทุกเมื่อเพื่อเลิกรับ',
  linked: 'เชื่อมเรียบร้อยแล้วค่ะ ต่อจากนี้บิลและใบเสร็จจะส่งมาทางนี้',
  'bad-code': 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว รบกวนขอรหัสใหม่อีกครั้งค่ะ',
  'opted-out': 'หยุดส่งข้อความให้แล้วค่ะ หากต้องการรับอีกครั้งแจ้งได้เลย',
}

export const handler = serveErrors(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const raw = await req.text()
  const signature = req.headers.get('x-line-signature') ?? ''

  // Destination must be decoded to select the tenant secret. No event is processed before verification.
  const hook = parseWebhook(raw)
  if (!hook) return ok()
  const db = admin()
  const { data: channel, error: channelError } = await db.from('line_channels')
    .select('provider_id, channel_secret, access_token, status')
    .eq('bot_user_id', hook.destination).maybeSingle()
  if (channelError) throw channelError
  if (!channel) return ok()

  const secret = await open(channel.channel_secret)
  if (!(await verifyLineSignature(raw, secret, signature))) {
    return new Response('bad signature', { status: 401 })
  }
  if (channel.status !== 'active') return ok()
  const token = await open(channel.access_token)

  const reply = async (replyToken: string | undefined, key: keyof typeof REPLIES) => {
    if (!replyToken) return
    const request = replyRequest(token, replyToken, REPLIES[key])
    // A reply is best-effort; persisted state remains authoritative if LINE rejects an expired token.
    await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }

  for (const event of hook.events) {
    const userId = 'userId' in event ? event.userId : ''
    const eventId = event.eventId
    if (!userId || !eventId) continue
    const { data: claimToken, error: claimError } = await db.rpc('claim_line_webhook_event', {
      p_provider_id: channel.provider_id, p_event_id: eventId,
    })
    if (claimError) throw claimError
    if (!claimToken) continue

    try {
      const { data: recipient, error: recipientError } = await db.from('line_recipients')
        .select('id, client_id, unfollowed_at')
        .eq('provider_id', channel.provider_id).eq('line_user_id', userId).maybeSingle()
      if (recipientError) throw recipientError
      const plan = planWebhookEvent(event, !!recipient?.client_id)

      if (plan.kind === 'register') {
        const { error } = await db.from('line_recipients').upsert(
          { provider_id: channel.provider_id, line_user_id: plan.userId, unfollowed_at: null },
          { onConflict: 'provider_id,line_user_id' })
        if (error) throw error
        await reply(event.type === 'follow' ? event.replyToken : undefined, 'ask-code')
      } else if (plan.kind === 'unfollow' || plan.kind === 'opt-out') {
        const { error } = await db.from('line_recipients').update({ unfollowed_at: new Date().toISOString() })
          .eq('provider_id', channel.provider_id).eq('line_user_id', plan.userId)
        if (error) throw error
        if (plan.kind === 'opt-out') await reply(event.type === 'message' ? event.replyToken : undefined, 'opted-out')
      } else if (plan.kind === 'link') {
        const { data, error } = await db.rpc('redeem_line_link_code', {
          p_provider_id: channel.provider_id, p_line_user_id: plan.userId, p_code: plan.code,
        })
        if (error) throw error
        await reply(event.type === 'message' ? event.replyToken : undefined,
          data?.[0]?.ok === true ? 'linked' : 'bad-code')
      } else if (plan.kind === 'inbound' && recipient?.client_id) {
        const { error } = await db.from('chats').upsert({
          provider_id: channel.provider_id, client_id: recipient.client_id,
          sender: 'client', body: plan.text, occurred_at: new Date().toISOString(),
          source_event_id: eventId,
        }, { onConflict: 'provider_id,source_event_id', ignoreDuplicates: true })
        if (error) throw error
      }
      const { data: finished, error: finishError } = await db.rpc('finish_line_webhook_event', {
        p_provider_id: channel.provider_id, p_event_id: eventId,
        p_claim_token: claimToken, p_success: true, p_error: null,
      })
      if (finishError || finished !== true) throw finishError ?? new Error('Webhook claim lost')
    } catch (error) {
      await db.rpc('finish_line_webhook_event', {
        p_provider_id: channel.provider_id, p_event_id: eventId,
        p_claim_token: claimToken, p_success: false, p_error: 'handler-failed',
      })
      throw error
    }
  }
  return ok()
})

if (import.meta.main) Deno.serve(handler)
