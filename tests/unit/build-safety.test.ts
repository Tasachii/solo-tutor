import { describe, expect, it } from 'vitest'
import { contentPolicy, makeRelease, basePath } from '../../build/siteSafety'

describe('release build safety', () => {
  it('permits only the configured project and refuses policy injection', () => {
    expect(contentPolicy('https://one.supabase.co')).toContain("connect-src 'self' https://one.supabase.co ")
    expect(contentPolicy('')).not.toContain('supabase.co')
    for (const url of ['https://*.supabase.co', 'https://one.supabase.co/x', 'https://one.supabase.co; script-src *', 'https://user:pw@one.supabase.co', 'http://remote.test']) {
      expect(() => contentPolicy(url)).toThrow()
    }
    expect(contentPolicy('http://127.0.0.1:54321')).toContain('http://127.0.0.1:54321')
  })
  it('hashes lazy chunks, unhashed fonts and the worker so a changed release cannot overwrite the active cache', () => {
    const files = [{ path: 'index.html', bytes: Buffer.from('shell') }, { path: 'assets/lazy.js', bytes: Buffer.from('lazy') }, { path: 'fonts/font.ttf', bytes: Buffer.from('font') }]
    const first = makeRelease(files, 'worker')
    expect(first.assets.map(x => x.path)).toEqual(['./', 'assets/lazy.js', 'fonts/font.ttf'])
    expect(first.assets.every(x => x.integrity.startsWith('sha256-'))).toBe(true)
    expect(makeRelease([...files].reverse(), 'worker').version).toBe(first.version)
    expect(makeRelease(files.map(x => x.path.endsWith('.ttf') ? { ...x, bytes: Buffer.from('changed') } : x), 'worker').version).not.toBe(first.version)
    expect(makeRelease(files, 'new worker').version).not.toBe(first.version)
  })
  it('supports a dedicated site root while rejecting unsafe base paths', () => {
    expect(basePath('')).toBe('/solo-tutor/')
    expect(basePath('/')).toBe('/')
    for (const path of ['https://foreign.test/', '//foreign/', '/a/../', '/x?bad/', '/x%2f/']) expect(() => basePath(path)).toThrow()
  })
})
