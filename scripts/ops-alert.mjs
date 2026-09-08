import { pathToFileURL } from 'node:url'

/**
 * ปลายทางแจ้งเตือนที่มีอยู่จริงวันนี้: GitHub Issue ของ repo นี้ (เจ้าของได้อีเมล/มือถือจาก GitHub ทันที)
 * หนึ่ง issue ต่อหนึ่ง check (label ops-alert) — งานล้มซ้ำเติม comment ไม่เปิด issue ใหม่ และไม่ comment ถี่กว่าทุก 6 ชม.
 * ข้อความมีแค่ชื่อ check กับลิงก์ run ไม่มีชื่อเด็ก ยอดเงิน หรือหลักฐานธนาคาร
 * ปลายทางเสริม (LINE/Slack webhook) เปิดได้ด้วย OPERATIONS_ALERT_WEBHOOK เมื่อเจ้าของกำหนด
 */
export const LABEL = 'ops-alert'
export const COMMENT_COOLDOWN_MS = 6 * 60 * 60 * 1000

export const alertTitle = (check) => `[ops] ${check} ล้ม`
export const alertBody = (check, runUrl) =>
  `การตรวจ **${check}** ล้ม ดูรายละเอียดที่ ${runUrl}\n\nปิด issue นี้เมื่อแก้แล้ว — ถ้ายังล้มอีก ระบบจะ comment ต่อในนี้ ไม่เปิดใหม่`

/** ตัดสินว่าจะเปิด issue ใหม่ / comment / เงียบ จากรายการ issue ที่เปิดอยู่ */
export function decideAlert(check, openIssues, now = Date.now()) {
  const title = alertTitle(check)
  const existing = openIssues.find((issue) => issue.title === title)
  if (!existing) return { action: 'create', title }
  const last = Date.parse(existing.updated_at ?? '')
  if (Number.isFinite(last) && now - last < COMMENT_COOLDOWN_MS) return { action: 'skip', number: existing.number }
  return { action: 'comment', number: existing.number }
}

const api = async (token, repo, path, init = {}) => {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub API ${path} failed (${response.status})`)
  return response.status === 204 ? null : response.json()
}

export async function raiseAlert({ token, repo, check, runUrl, webhook, now = Date.now(), fetcher = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Bad repository name')
  const run = new URL(runUrl)
  if (run.origin !== 'https://github.com') throw new Error('Run URL must be on github.com')
  const open = await api(token, repo, `/issues?state=open&labels=${LABEL}&per_page=50`)
  const decision = decideAlert(check, Array.isArray(open) ? open : [], now)
  if (decision.action === 'create') {
    await api(token, repo, '/issues', { method: 'POST', body: JSON.stringify({ title: decision.title, body: alertBody(check, run.href), labels: [LABEL] }) })
  } else if (decision.action === 'comment') {
    await api(token, repo, `/issues/${decision.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `ยังล้มอยู่: ${run.href}` }) })
  }
  if (webhook) {
    const target = new URL(webhook)
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid alert webhook')
    const response = await fetcher(target.href, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Solo Tutor: ${check} ล้ม ${run.href}` }), redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Alert webhook failed (${response.status})`)
  }
  return decision
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv[2]
  const token = process.env.GH_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  const runUrl = `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
  if (!check || !token || !repo || !process.env.GITHUB_RUN_ID) throw new Error('ops-alert needs a check name, GH_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID')
  const result = await raiseAlert({ token, repo, check, runUrl, webhook: process.env.OPERATIONS_ALERT_WEBHOOK?.trim() || undefined })
  console.log(`ops-alert: ${result.action}${result.number ? ` #${result.number}` : ''}`)
}
