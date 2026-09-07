import { normalizeWaitlist } from '../../supabase/functions/waitlist/index.ts'
import { normalizeReport } from '../../supabase/functions/report-error/index.ts'

const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test('waitlist keeps only known sizes and modes, trims text, drops junk', () => {
  equal(normalizeWaitlist({
    professionId: 'tutor', name: '  ครูมายด์ ', contact: 'line: mind', size: '10–30',
    modes: ['per_unit', 'bogus', 42], concierge: true, extra: 'ignored',
  }), {
    profession_id: 'tutor', name: 'ครูมายด์', contact: 'line: mind', size: '10–30',
    modes: ['per_unit'], concierge: true,
  })
  equal(normalizeWaitlist({ professionId: 'tutor', name: 'x', contact: 'y', size: 'huge' })?.size, null)
})

Deno.test('waitlist refuses rows without the three required fields or over length', () => {
  equal(normalizeWaitlist({ name: 'x', contact: 'y' }), null)
  equal(normalizeWaitlist({ professionId: 'tutor', name: '', contact: 'y' }), null)
  equal(normalizeWaitlist({ professionId: 'tutor', name: 'x'.repeat(121), contact: 'y' }), null)
})

Deno.test('error report clips every field and never accepts unknown ones', () => {
  const row = normalizeReport({
    message: 'TypeError: boom', stack: 's'.repeat(5000), route: '#/app/billing',
    appVersion: 'abc123', userAgent: 'ua', mode: 'real', students: ['น้องปลา'],
  })!
  equal(Object.keys(row).sort(), ['app_version', 'message', 'mode', 'route', 'stack', 'user_agent'])
  equal(row.stack!.toString().length, 4000)
  equal(normalizeReport({ stack: 'no message' }), null)
  equal(normalizeReport({ message: 'x', mode: 'weird' })!.mode, null)
})
