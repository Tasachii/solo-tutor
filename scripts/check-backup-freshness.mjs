import { pathToFileURL } from 'node:url'

export function backupIsFresh(runs, now = Date.now()) {
  return runs.some((run) => {
    const created = Date.parse(run.created_at)
    return run.status === 'completed' && run.conclusion === 'success'
      && Number.isFinite(created) && created <= now && now - created <= 2 * 24 * 60 * 60 * 1000
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GH_REPOSITORY
  const token = process.env.GH_TOKEN
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw new Error('Missing backup monitor configuration')
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/backup.yml/runs?per_page=100&status=success`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Backup monitor API failed (${response.status})`)
  const result = await response.json()
  if (!Array.isArray(result.workflow_runs) || !backupIsFresh(result.workflow_runs)) {
    throw new Error('No successful backup within 2 days; investigate backup workflow and restore readiness')
  }
  console.log('A backup workflow succeeded within the last 2 days. This does not prove restore integrity.')
}
