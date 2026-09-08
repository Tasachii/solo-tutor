import { beforeEach, describe, expect, it } from 'vitest'
import { exportRecoveryKey, importRecoveryKey, keyFromPassword, loadKey, rememberKey, rememberKeyFromPassword } from '../../src/core/cloudKey'
import { open, seal } from '../../src/core/cloudCrypto'

describe('cloud recovery key', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips only for the same account and decrypts its snapshot', async () => {
    const key = await keyFromPassword('teacher-1', 'password-one')
    const sealed = await seal(key, 'ledger')
    const file = await exportRecoveryKey('teacher-1', key)
    const recovered = await importRecoveryKey('teacher-1', file)
    expect(recovered).not.toBeNull()
    expect(await open(recovered!, sealed)).toBe('ledger')
    expect(await importRecoveryKey('teacher-2', file)).toBeNull()
    expect(await importRecoveryKey('teacher-1', '{bad')).toBeNull()
  })

  it('does not replace a remembered good key until a caller explicitly persists a verified key', async () => {
    const good = await keyFromPassword('teacher-1', 'good-password')
    await rememberKey('teacher-1', good)
    await rememberKeyFromPassword('teacher-1', 'wrong-password')
    const stillGood = await loadKey('teacher-1')
    const sealed = await seal(good, 'ledger')
    expect(await open(stillGood!, sealed)).toBe('ledger')
  })
})
