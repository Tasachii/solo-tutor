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

import { normalizeUsage } from '../../supabase/functions/usage/index.ts'

Deno.test('usage accepts only the four agreed events with a uuid and a bounded count', () => {
  const id = '3fef1b5f-0dfd-4beb-8f4c-c779c07a2670'
  equal(normalizeUsage({ teacher_id: id, event: 'invoice_issued', count: 3, mode: 'real', student: 'น้องปลา' }),
    { teacher_id: id, event: 'invoice_issued', count: 3, mode: 'real' })
  equal(normalizeUsage({ teacher_id: id, event: 'login', count: 1 }), null)
  equal(normalizeUsage({ teacher_id: 'not-a-uuid', event: 'app_open', count: 1 }), null)
  equal(normalizeUsage({ teacher_id: id, event: 'app_open', count: -1 }), null)
  equal(normalizeUsage({ teacher_id: id, event: 'app_open', count: 1.5 }), null)
  equal(normalizeUsage({ teacher_id: id, event: 'app_open', count: 1, mode: 'weird' })!.mode, null)
})
