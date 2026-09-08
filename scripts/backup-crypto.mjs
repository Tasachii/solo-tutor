import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

/**
 * รูปแบบสำรอง SOLOBAK1: header(magic 8 | salt 16 | nonce 12) · AES-256-GCM(body) · tag 16
 * - มี authentication tag: ไฟล์ถูกแก้/ตัด/กุญแจผิด → ถอดไม่ผ่านและไม่เหลือ plaintext ค้าง
 * - PBKDF2-SHA256 600,000 รอบจาก BACKUP_PASSPHRASE (≥ 24 ตัว) · header เป็น AAD
 * - เขียนแบบ exclusive (ไม่ทับไฟล์เดิม) สิทธิ์ 0600
 * ไฟล์เก่า .tar.gz.enc (openssl aes-256-cbc) ถอดด้วยคำสั่งใน docs/backup-restore.md ไม่ผ่านโปรแกรมนี้
 */
export const MAGIC = Buffer.from('SOLOBAK1')
export const HEADER_SIZE = 8 + 16 + 12
export const TAG_SIZE = 16
export const ITERATIONS = 600_000

const writer = (file) => new Writable({ write(chunk, _enc, done) { file.writeFile(chunk).then(() => done(), done) } })
async function readExactly(file, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, position + offset)
    if (!bytesRead) throw new Error('Incomplete backup')
    offset += bytesRead
  }
}
export function deriveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 24) throw new Error('Backup passphrase must contain at least 24 characters')
  return pbkdf2Sync(passphrase, salt, ITERATIONS, 32, 'sha256')
}

export async function encryptBackup(input, output, passphrase) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const header = Buffer.concat([MAGIC, salt, iv])
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  cipher.setAAD(header)
  const file = await open(output, 'wx', 0o600)
  try {
    await file.writeFile(header)
    await pipeline(createReadStream(input), cipher, writer(file))
    await file.writeFile(cipher.getAuthTag())
    await file.sync()
  } catch (error) {
    await file.close().catch(() => undefined)
    await unlink(output).catch(() => undefined)
    throw error
  }
  await file.close()
}

/** ห้ามใช้ผลลัพธ์ก่อน promise นี้สำเร็จ — tag ท้ายไฟล์คือสิ่งที่รับรองทั้ง archive */
export async function decryptBackup(input, output, passphrase) {
  const size = (await stat(input)).size
  if (size < HEADER_SIZE + TAG_SIZE) throw new Error('Incomplete backup')
  const file = await open(input, 'r')
  const header = Buffer.alloc(HEADER_SIZE)
  const tag = Buffer.alloc(TAG_SIZE)
  try {
    await readExactly(file, header, 0)
    await readExactly(file, tag, size - TAG_SIZE)
  } finally { await file.close() }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported backup format; legacy .enc files use the openssl procedure in docs/backup-restore.md')
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, header.subarray(8, 24)), header.subarray(24, 36))
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  const outputFile = await open(output, 'wx', 0o600)
  try {
    if (size === HEADER_SIZE + TAG_SIZE) decipher.final()
    else await pipeline(createReadStream(input, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }), decipher, writer(outputFile))
    await outputFile.sync()
    await outputFile.close()
  } catch {
    await outputFile.close().catch(() => undefined)
    await unlink(output).catch(() => undefined)
    throw new Error('Backup authentication failed; no decrypted output retained')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, input, output] = process.argv.slice(2)
  const passphrase = process.env.BACKUP_PASSPHRASE
  if (!['encrypt', 'decrypt'].includes(mode) || !input || !output || !passphrase) {
    console.error('usage: BACKUP_PASSPHRASE=… node scripts/backup-crypto.mjs encrypt|decrypt INPUT OUTPUT')
    process.exit(2)
  }
  await (mode === 'encrypt' ? encryptBackup : decryptBackup)(input, output, passphrase)
  console.log(`${mode}: ${output}`)
}
