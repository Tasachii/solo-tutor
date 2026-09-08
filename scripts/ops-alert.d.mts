export const LABEL: string
export const COMMENT_COOLDOWN_MS: number
export function alertTitle(check: string): string
export function alertBody(check: string, runUrl: string): string
export interface OpenIssue { number: number; title: string; updated_at?: string }
export type AlertDecision = { action: 'create'; title: string } | { action: 'comment' | 'skip'; number: number }
export function decideAlert(check: string, openIssues: OpenIssue[], now?: number): AlertDecision
export function raiseAlert(input: {
  token: string; repo: string; check: string; runUrl: string; webhook?: string; now?: number; fetcher?: typeof fetch
}): Promise<AlertDecision>
