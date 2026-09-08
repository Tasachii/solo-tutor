import type { AppState } from '../../../src/core/types'
import { toBackup } from '../../../src/core/backup'
export { packSnapshot, PRE_PULL_BACKUP_KEY, readSyncMeta, SYNC_META_KEY, writeSyncMeta } from '../../../src/core/cloudSync'
export const toBackupForTests = (state: AppState, at: string): string => toBackup(state, at)
