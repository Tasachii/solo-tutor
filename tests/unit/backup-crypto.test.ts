import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptBackup, encryptBackup, HEADER_SIZE } from '../../scripts/backup-crypto.mjs'

/** รูปแบบสำรอง SOLOBAK1 — ต้องจับ กุญแจผิด / ไฟล์ถูกตัด / ถูกแก้ และไม่ทิ้ง plaintext ไว้ */
const passphrase = 'unit-test-passphrase-that-is-long-enough'
let dir = ''
const missing = async (p: string) => { try { await stat(p); return false } catch { return true } }

afterEach(() => { dir = '' })

describe('backup-crypto', () => {
  it('encrypt → decrypt ได้ไฟล์เดิมทุกไบต์ และ ciphertext ไม่มีเนื้อหาเดิม', async () => {
    dir = await mkdtemp(join(tmpdir(), 'solobak-'))
    const plain = join(dir, 'dump.tar.gz'); const enc = join(dir, 'dump.solobak'); const out = join(dir, 'restored.tar.gz')
    const payload = Buffer.from('insert into public.clients values (\'ครูมายด์\');' + 'x'.repeat(5000))
    await writeFile(plain, payload)
    await encryptBackup(plain, enc, passphrase)
    const cipher = await readFile(enc)
    expect(cipher.subarray(0, 8).toString()).toBe('SOLOBAK1')
    expect(cipher.includes(Buffer.from('ครูมายด์'))).toBe(false)
    await decryptBackup(enc, out, passphrase)
    expect((await readFile(out)).equals(payload)).toBe(true)
  }, 20_000)

  it('กุญแจผิด · ไฟล์ถูกตัด · ไบต์ถูกแก้ → ปฏิเสธ และไม่มีไฟล์ถอดค้าง', async () => {
    dir = await mkdtemp(join(tmpdir(), 'solobak-'))
    const plain = join(dir, 'dump.tar.gz'); const enc = join(dir, 'dump.solobak')
    await writeFile(plain, Buffer.from('payload-'.repeat(200)))
    await encryptBackup(plain, enc, passphrase)
    const wrong = join(dir, 'wrong.out')
    await expect(decryptBackup(enc, wrong, 'another-passphrase-also-long-enough-24')).rejects.toThrow(/authentication failed/)
    expect(await missing(wrong)).toBe(true)
    const cipher = await readFile(enc)
    const truncated = join(dir, 'trunc.solobak'); await writeFile(truncated, cipher.subarray(0, cipher.length - 5))
    await expect(decryptBackup(truncated, join(dir, 'trunc.out'), passphrase)).rejects.toThrow()
    expect(await missing(join(dir, 'trunc.out'))).toBe(true)
    const flipped = Buffer.from(cipher); flipped[HEADER_SIZE + 3] ^= 0x01
    const tampered = join(dir, 'tamper.solobak'); await writeFile(tampered, flipped)
    await expect(decryptBackup(tampered, join(dir, 'tamper.out'), passphrase)).rejects.toThrow(/authentication failed/)
    expect(await missing(join(dir, 'tamper.out'))).toBe(true)
  }, 30_000)

  it('ไฟล์รูปแบบเก่า (openssl) ไม่ถูกตีความผิด และไม่ทับไฟล์ปลายทางที่มีอยู่', async () => {
    dir = await mkdtemp(join(tmpdir(), 'solobak-'))
    const legacy = join(dir, 'old.enc'); await writeFile(legacy, Buffer.concat([Buffer.from('Salted__'), Buffer.alloc(64, 7)]))
    await expect(decryptBackup(legacy, join(dir, 'legacy.out'), passphrase)).rejects.toThrow(/Unsupported backup format/)
    const plain = join(dir, 'p'); await writeFile(plain, 'x')
    const existing = join(dir, 'exists'); await writeFile(existing, 'keep')
    await expect(encryptBackup(plain, existing, passphrase)).rejects.toThrow()
    expect((await readFile(existing)).toString()).toBe('keep')
    await expect(encryptBackup(plain, join(dir, 'short.solobak'), 'short')).rejects.toThrow(/24 characters/)
  }, 20_000)
})
