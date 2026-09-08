import process from 'node:process'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EVENTS = new Set(['app_open', 'students_changed', 'invoice_issued', 'payment_recorded'])
const REQUIRED = ['at', 'count', 'event', 'random_id']
const quote = value => `"${String(value).replaceAll('"', '""')}"`

let input = ''
for await (const chunk of process.stdin) input += chunk

try {
  const result = JSON.parse(input)
  if (!result || !Array.isArray(result.rows)) throw new Error('Supabase query did not return a rows array')
  const lines = ['random_id,event,count,at']
  for (const row of result.rows) {
    if (!row || Object.keys(row).sort().join(',') !== REQUIRED.join(',')) throw new Error('Unexpected usage export fields')
    if (typeof row.random_id !== 'string' || !UUID.test(row.random_id)
      || typeof row.event !== 'string' || !EVENTS.has(row.event)
      || typeof row.count !== 'number' || !Number.isInteger(row.count) || row.count < 0 || row.count > 10000
      || typeof row.at !== 'string' || !Number.isFinite(new Date(row.at).getTime())) {
      throw new Error('Invalid usage export row')
    }
    lines.push([row.random_id.toLowerCase(), row.event, row.count, row.at].map(quote).join(','))
  }
  process.stdout.write(`${lines.join('\n')}\n`)
} catch (error) {
  process.stderr.write(`Usage export failed: ${error instanceof Error ? error.message : 'invalid response'}\n`)
  process.exitCode = 1
}
