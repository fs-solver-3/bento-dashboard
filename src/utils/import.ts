import type {
  ExportedData,
  Note,
  Task,
  UserPreferences,
  WidgetConfig,
  WidgetSize,
  WidgetType,
} from '../types'
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notifications'
import { SCHEMA_VERSION } from './export'

/**
 * Backup import.
 *
 * `validateBackup` and `parseBackup` are pure: they take a value (or a string)
 * and return a verdict. All of the File/FileReader plumbing lives at the bottom
 * of this file in `readBackupFile`, so the rules can be unit-tested without
 * constructing a File.
 *
 * Validation is all-or-nothing on purpose. A file is either installed whole or
 * refused whole, so a half-readable file can never leave the dashboard holding
 * a mix of old and new records.
 */

export interface ImportSuccess {
  ok: true
  data: ExportedData
  /** The `exportedAt` stamp from the envelope, when it was readable. */
  exportedAt: string | null
}

export interface ImportFailure {
  ok: false
  error: string
}

export type ImportResult = ImportSuccess | ImportFailure

const NOT_A_BACKUP = 'This file is not a Bento backup file.'

const WIDGET_TYPES: readonly WidgetType[] = [
  'clock',
  'weather',
  'notes',
  'pomodoro',
  'tasks',
  'quote',
  'calendar',
  'search',
]
const WIDGET_SIZES: readonly WidgetSize[] = ['small', 'medium', 'large']
const PRIORITIES: readonly Task['priority'][] = ['low', 'medium', 'high']
const THEMES: readonly UserPreferences['theme'][] = ['light', 'dark', 'system']
const LAYOUTS: readonly UserPreferences['dashboardLayout'][] = ['grid', 'flex']

function fail(error: string): ImportFailure {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Dates round-trip through JSON as ISO strings even though they are typed
 * `Date`. Call sites already compensate with `new Date(...)`, so values are
 * left exactly as the file had them - this only checks they are readable.
 */
function isDateLike(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (typeof value === 'string' || typeof value === 'number') {
    return !Number.isNaN(new Date(value).getTime())
  }
  return false
}

function ordinal(index: number): string {
  return `#${index + 1}`
}

function validateWidget(raw: unknown, index: number): string | null {
  if (!isRecord(raw)) return `Widget ${ordinal(index)} in this backup is not readable.`
  if (!isNonEmptyString(raw.id)) return `Widget ${ordinal(index)} in this backup has no id.`
  if (!WIDGET_TYPES.includes(raw.type as WidgetType)) {
    return `Widget ${ordinal(index)} in this backup has an unknown type.`
  }
  if (!WIDGET_SIZES.includes(raw.size as WidgetSize)) {
    return `Widget ${ordinal(index)} in this backup has an unknown size.`
  }
  const position = raw.position
  if (
    !isRecord(position) ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return `Widget ${ordinal(index)} in this backup has an invalid position.`
  }
  if (raw.settings !== undefined && !isRecord(raw.settings)) {
    return `Widget ${ordinal(index)} in this backup has invalid settings.`
  }
  return null
}

function validateNote(raw: unknown, index: number): string | null {
  if (!isRecord(raw)) return `Note ${ordinal(index)} in this backup is not readable.`
  if (!isNonEmptyString(raw.id)) return `Note ${ordinal(index)} in this backup has no id.`
  if (typeof raw.content !== 'string') {
    return `Note ${ordinal(index)} in this backup has no content.`
  }
  if (typeof raw.color !== 'string') {
    return `Note ${ordinal(index)} in this backup has no color.`
  }
  if (!isDateLike(raw.createdAt)) {
    return `Note ${ordinal(index)} in this backup has an unreadable created date.`
  }
  if (!isDateLike(raw.updatedAt)) {
    return `Note ${ordinal(index)} in this backup has an unreadable updated date.`
  }
  return null
}

function validateTask(raw: unknown, index: number): string | null {
  if (!isRecord(raw)) return `Task ${ordinal(index)} in this backup is not readable.`
  if (!isNonEmptyString(raw.id)) return `Task ${ordinal(index)} in this backup has no id.`
  if (typeof raw.title !== 'string') {
    return `Task ${ordinal(index)} in this backup has no title.`
  }
  if (typeof raw.completed !== 'boolean') {
    return `Task ${ordinal(index)} in this backup has no completed flag.`
  }
  if (!PRIORITIES.includes(raw.priority as Task['priority'])) {
    return `Task ${ordinal(index)} in this backup has an unknown priority.`
  }
  if (!isDateLike(raw.createdAt)) {
    return `Task ${ordinal(index)} in this backup has an unreadable created date.`
  }
  if (raw.dueDate !== undefined && raw.dueDate !== null && !isDateLike(raw.dueDate)) {
    return `Task ${ordinal(index)} in this backup has an unreadable due date.`
  }
  return null
}

function firstError(
  list: unknown[],
  check: (raw: unknown, index: number) => string | null
): string | null {
  for (let i = 0; i < list.length; i += 1) {
    const error = check(list[i], i)
    if (error) return error
  }
  return null
}

/**
 * Preferences are rebuilt field by field rather than passed through, so an
 * unknown theme or a missing notification block cannot reach the store. The
 * notification backfill is the same one `merge` in the store applies to
 * persisted payloads that predate notification settings.
 */
function normalizePreferences(raw: unknown, current: UserPreferences): UserPreferences {
  const saved = isRecord(raw) ? raw : {}
  const notifications = isRecord(saved.notifications) ? saved.notifications : {}
  const leadMinutes = notifications.taskReminderLeadMinutes

  return {
    theme: THEMES.includes(saved.theme as UserPreferences['theme'])
      ? (saved.theme as UserPreferences['theme'])
      : current.theme,
    userName: typeof saved.userName === 'string' ? saved.userName : current.userName,
    dashboardLayout: LAYOUTS.includes(saved.dashboardLayout as UserPreferences['dashboardLayout'])
      ? (saved.dashboardLayout as UserPreferences['dashboardLayout'])
      : current.dashboardLayout,
    animationsEnabled:
      typeof saved.animationsEnabled === 'boolean'
        ? saved.animationsEnabled
        : current.animationsEnabled,
    notifications: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(typeof notifications.enabled === 'boolean' ? { enabled: notifications.enabled } : {}),
      ...(typeof notifications.pomodoro === 'boolean' ? { pomodoro: notifications.pomodoro } : {}),
      ...(typeof notifications.tasks === 'boolean' ? { tasks: notifications.tasks } : {}),
      ...(typeof leadMinutes === 'number' && Number.isFinite(leadMinutes)
        ? { taskReminderLeadMinutes: Math.max(0, leadMinutes) }
        : {}),
    },
  }
}

/**
 * Checks a parsed value against the v1 envelope and returns either the data to
 * apply or a message a user can act on.
 *
 * `fallbackPreferences` supplies any preference the file omits or garbles, so
 * an import never leaves the dashboard with an undefined preference.
 */
export function validateBackup(raw: unknown, fallbackPreferences: UserPreferences): ImportResult {
  if (!isRecord(raw)) return fail(NOT_A_BACKUP)

  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return fail(`${NOT_A_BACKUP} It has no schema version.`)
  }
  if (version > SCHEMA_VERSION) {
    return fail(
      `This backup was created by a newer version of Bento (schema version ${version}). Update Bento and try again.`
    )
  }
  if (version !== SCHEMA_VERSION) {
    return fail(`${NOT_A_BACKUP} Schema version ${version} is not supported.`)
  }

  const data = raw.data
  if (!isRecord(data)) return fail('This backup has no data in it.')

  if (!Array.isArray(data.widgets)) return fail('This backup is missing its widgets.')
  if (!Array.isArray(data.notes)) return fail('This backup is missing its notes.')
  if (!Array.isArray(data.tasks)) return fail('This backup is missing its tasks.')

  const widgetError = firstError(data.widgets, validateWidget)
  if (widgetError) return fail(widgetError)
  const noteError = firstError(data.notes, validateNote)
  if (noteError) return fail(noteError)
  const taskError = firstError(data.tasks, validateTask)
  if (taskError) return fail(taskError)

  const pomodoro = data.pomodoro
  if (!isRecord(pomodoro)) return fail('This backup is missing its pomodoro sessions.')
  const sessionsCompleted = pomodoro.sessionsCompleted
  if (
    typeof sessionsCompleted !== 'number' ||
    !Number.isFinite(sessionsCompleted) ||
    sessionsCompleted < 0
  ) {
    return fail('This backup has an invalid pomodoro session count.')
  }

  return {
    ok: true,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    data: {
      widgets: data.widgets as WidgetConfig[],
      notes: data.notes as Note[],
      tasks: data.tasks as Task[],
      pomodoro: { sessionsCompleted: Math.floor(sessionsCompleted) },
      preferences: normalizePreferences(data.preferences, fallbackPreferences),
    },
  }
}

/** Same verdict as `validateBackup`, starting from the raw file text. */
export function parseBackup(text: string, fallbackPreferences: UserPreferences): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail(`${NOT_A_BACKUP} It is not valid JSON.`)
  }
  return validateBackup(parsed, fallbackPreferences)
}

/**
 * The only part of importing that needs the browser. Kept separate from the
 * rules above so the rules stay directly testable.
 */
export function readBackupFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('This file could not be read.'))
    reader.readAsText(file)
  })
}
