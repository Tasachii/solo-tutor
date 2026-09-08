import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

export function basePath(raw = ''): string {
  if (!raw) return '/solo-tutor/'
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(raw)) throw new Error('VITE_BASE_PATH must be a local absolute directory path')
  return raw
}

export function contentPolicy(raw = ''): string {
  let project = ''
  if (raw.trim()) {
    const url = new URL(raw.trim())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash || /[^A-Za-z0-9.:/\[\]-]/.test(url.origin)) {
      throw new Error('VITE_SUPABASE_URL must be one HTTPS project origin (HTTP allowed on loopback only)')
    }
    project = `${url.origin} `
  }
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' ${project}https://script.google.com https://script.googleusercontent.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'`
}

type ReleaseFile = { path: string; bytes: Uint8Array }
export function makeRelease(files: ReleaseFile[], worker: string) {
  const ordered = [...files].sort((a, b) => a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path))
  const assets = ordered.map(file => ({
    path: file.path === 'index.html' ? './' : file.path.split('/').map(encodeURIComponent).join('/'),
    integrity: `sha256-${createHash('sha256').update(file.bytes).digest('base64')}`,
  }))
  const version = createHash('sha256').update(worker).update(JSON.stringify(assets)).digest('hex').slice(0, 24)
  return { version, assets }
}

export function siteSafety(projectUrl: string): Plugin {
  const policy = contentPolicy(projectUrl)
  let outDir = ''
  let base = ''
  let building = false
  return {
    name: 'solo-site-safety',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); base = config.base; building = config.command === 'build' },
    transformIndexHtml(html) { return html.replace('__SOLO_CSP__', policy) },
    async closeBundle() {
      if (!building) return
      const workerPath = resolve(outDir, 'sw.js')
      const worker = await readFile(workerPath, 'utf8')
      const files: ReleaseFile[] = []
      async function visit(dir: string) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = resolve(dir, entry.name)
          if (entry.isDirectory()) await visit(path)
          else {
            const name = relative(outDir, path).split(sep).join('/')
            if (name !== 'sw.js' && /\.(?:html|js|css|ttf|woff2|svg|png|ico|pdf|webmanifest)$/.test(name)) {
              files.push({ path: name, bytes: await readFile(path) })
            }
          }
        }
      }
      await visit(outDir)
      const release = makeRelease(files, worker)
      await writeFile(workerPath, worker.replace('__SOLO_RELEASE__', release.version)
        .replace('/* __SOLO_ASSETS__ */ []', JSON.stringify(release.assets)))
      // Supported by Cloudflare Pages/Netlify static hosting; GitHub Pages ignores this file.
      await writeFile(resolve(outDir, '_headers'), `/*\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n${base}sw.js\n  Cache-Control: no-cache\n${base}\n  Cache-Control: no-cache\n${base}index.html\n  Cache-Control: no-cache\n${base}assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`)
    },
  }
}
