export const MAGIC: Buffer
export const HEADER_SIZE: number
export const TAG_SIZE: number
export const ITERATIONS: number
export function deriveKey(passphrase: string, salt: Uint8Array): Buffer
export function encryptBackup(input: string, output: string, passphrase: string): Promise<void>
export function decryptBackup(input: string, output: string, passphrase: string): Promise<void>
