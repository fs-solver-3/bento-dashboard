import type { BackupFile, ExportedData, DashboardState } from '../types'

/**
 * Backup export.
 *
 * Everything here is local: the envelope is built from in-memory state, handed
 * to the browser as a Blob, and downloaded. Nothing leaves the machine.
 *
 * The envelope is versioned up front so a future shape change can be detected
 * by an older build instead of being half-imported.
 */

export const SCHEMA_VERSION = 1

/** The slices of the store a backup is built from - the same five `partialize` persists. */
export type ExportableState = Pick<
  DashboardState,
  'widgets' | 'notes' | 'tasks' | 'pomodoro' | 'preferences'
>

/**
 * Builds the envelope. Pure, so it can be asserted on without touching the DOM.
 *
 * Only `pomodoro.sessionsCompleted` travels: a file carrying `isRunning: true`
 * and a stale `timeLeft` would start a phantom timer on the importing device.
 */
export function buildBackup(state: ExportableState, now: Date = new Date()): BackupFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data: {
      widgets: state.widgets,
      notes: state.notes,
      tasks: state.tasks,
      pomodoro: { sessionsCompleted: state.pomodoro.sessionsCompleted },
      preferences: state.preferences,
    },
  }
}

/** Pretty-printed so a curious user can read their own backup. */
export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

/** e.g. `bento-backup-2026-10-26.json` */
export function backupFileName(now: Date = new Date()): string {
  return `bento-backup-${now.toISOString().slice(0, 10)}.json`
}

/** Plain-language summary of what a backup holds, for the UI. */
export function describeBackup(data: ExportedData): string {
  const parts = [
    `${data.notes.length} ${data.notes.length === 1 ? 'note' : 'notes'}`,
    `${data.tasks.length} ${data.tasks.length === 1 ? 'task' : 'tasks'}`,
    `${data.widgets.length} ${data.widgets.length === 1 ? 'widget' : 'widgets'}`,
  ]
  return parts.join(', ')
}

/**
 * Triggers the browser download. The Blob URL is revoked straight after the
 * synchronous click so the serialized copy does not sit in memory.
 *
 * Returns the envelope it wrote, so a caller can report on it.
 */
export function downloadBackup(state: ExportableState, now: Date = new Date()): BackupFile {
  const backup = buildBackup(state, now)
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = backupFileName(now)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)

  URL.revokeObjectURL(url)
  return backup
}
