import { describe, it, expect } from 'vitest'
import { parseBackup, readBackupFile, validateBackup } from '../src/utils/import'
import { DEFAULT_PREFERENCES } from '../src/utils/preferences'
import { buildBackup, serializeBackup, type ExportableState } from '../src/utils/export'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/utils/notifications'
import type { UserPreferences } from '../src/types'

// Deliberately different from DEFAULT_PREFERENCES in every field, so a test
// can tell which baseline a fallback came from.
const currentPreferences: UserPreferences = {
  theme: 'dark',
  userName: 'Ada',
  dashboardLayout: 'flex',
  animationsEnabled: false,
  notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false },
}

const merging = { mode: 'merge', currentPreferences } as const
const replacing = { mode: 'replace', currentPreferences } as const

const widget = () => ({ id: 'w1', type: 'clock', position: { x: 0, y: 0 }, size: 'medium' })

const note = () => ({
  id: 'n1',
  content: 'hello',
  color: 'yellow',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
})

const task = () => ({
  id: 't1',
  title: 'do the thing',
  completed: false,
  priority: 'high',
  createdAt: '2026-01-01T10:00:00.000Z',
})

const file = (overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  exportedAt: '2026-10-26T12:00:00.000Z',
  data: {
    widgets: [widget()],
    notes: [note()],
    tasks: [task()],
    pomodoro: { sessionsCompleted: 3 },
    preferences: currentPreferences,
    ...data,
  },
  ...overrides,
})

const validate = (raw: unknown) => validateBackup(raw, merging)

const errorOf = (raw: unknown) => {
  const result = validate(raw)
  if (result.ok) throw new Error('expected the file to be refused')
  return result.error
}

describe('envelope', () => {
  it('accepts a schema version 1 file', () => {
    const result = validate(file())

    expect(result.ok).toBe(true)
  })

  it('refuses a value that is not an object', () => {
    expect(errorOf('nope')).toContain('not a Bento backup file')
    expect(errorOf(null)).toContain('not a Bento backup file')
    expect(errorOf([file()])).toContain('not a Bento backup file')
  })

  it('refuses a file with no schema version', () => {
    const withoutVersion: Record<string, unknown> = { ...file() }
    delete withoutVersion.schemaVersion

    expect(errorOf(withoutVersion)).toBe(
      'This file is not a Bento backup file. It has no schema version.'
    )
  })

  it('refuses a non-numeric schema version', () => {
    expect(errorOf(file({ schemaVersion: '1' }))).toContain('no schema version')
    expect(errorOf(file({ schemaVersion: Number.NaN }))).toContain('no schema version')
  })

  it('refuses a file from a newer version of Bento', () => {
    expect(errorOf(file({ schemaVersion: 2 }))).toBe(
      'This backup was created by a newer version of Bento (schema version 2). Update Bento and try again.'
    )
  })

  it('refuses an unsupported older version separately', () => {
    expect(errorOf(file({ schemaVersion: 0 }))).toContain('Schema version 0 is not supported')
  })

  it('refuses a file with no data section', () => {
    expect(errorOf(file({ data: undefined }))).toBe('This backup has no data in it.')
  })

  it('keeps the exportedAt stamp when it is readable', () => {
    const result = validate(file())

    expect(result.ok && result.exportedAt).toBe('2026-10-26T12:00:00.000Z')
  })

  it('tolerates a missing exportedAt stamp', () => {
    const result = validate(file({ exportedAt: undefined }))

    expect(result.ok && result.exportedAt).toBeNull()
  })
})

describe('slices', () => {
  it('refuses a missing or non-list slice', () => {
    expect(errorOf(file({}, { widgets: undefined }))).toContain('missing its widgets')
    expect(errorOf(file({}, { notes: 'none' }))).toContain('missing its notes')
    expect(errorOf(file({}, { tasks: {} }))).toContain('missing its tasks')
  })

  it('refuses a widget with an unknown type, size or position', () => {
    expect(errorOf(file({}, { widgets: [{ ...widget(), type: 'stocks' }] }))).toContain(
      'unknown type'
    )
    expect(errorOf(file({}, { widgets: [{ ...widget(), size: 'enormous' }] }))).toContain(
      'unknown size'
    )
    expect(errorOf(file({}, { widgets: [{ ...widget(), position: { x: 'left', y: 0 } }] }))).toContain(
      'invalid position'
    )
  })

  it('refuses a record with no id', () => {
    expect(errorOf(file({}, { notes: [{ ...note(), id: '' }] }))).toContain('Note #1')
    expect(errorOf(file({}, { tasks: [{ ...task(), id: undefined }] }))).toContain('Task #1')
  })

  it('names the offending record by position', () => {
    expect(errorOf(file({}, { notes: [note(), { ...note(), id: 'n2', content: 42 }] }))).toBe(
      'Note #2 in this backup has no content.'
    )
  })

  it('refuses an unreadable date', () => {
    expect(errorOf(file({}, { notes: [{ ...note(), createdAt: 'last tuesday' }] }))).toContain(
      'unreadable created date'
    )
    expect(errorOf(file({}, { tasks: [{ ...task(), dueDate: 'soon' }] }))).toContain(
      'unreadable due date'
    )
  })

  it('accepts a task with no due date', () => {
    const result = validate(file({}, { tasks: [{ ...task(), dueDate: undefined }] }))

    expect(result.ok).toBe(true)
  })

  it('refuses an unknown priority', () => {
    expect(errorOf(file({}, { tasks: [{ ...task(), priority: 'urgent' }] }))).toContain(
      'unknown priority'
    )
  })

  it('refuses a missing or nonsensical pomodoro tally', () => {
    expect(errorOf(file({}, { pomodoro: undefined }))).toContain('missing its pomodoro sessions')
    expect(errorOf(file({}, { pomodoro: { sessionsCompleted: -1 } }))).toContain(
      'invalid pomodoro session count'
    )
    expect(errorOf(file({}, { pomodoro: { sessionsCompleted: 'lots' } }))).toContain(
      'invalid pomodoro session count'
    )
  })

  it('accepts empty slices', () => {
    const result = validate(file({}, { widgets: [], notes: [], tasks: [] }))

    expect(result.ok).toBe(true)
  })
})

describe('dates', () => {
  it('leaves date fields exactly as the file had them', () => {
    const result = validate(file())

    // They are typed `Date` but travel as ISO strings; call sites already
    // compensate with `new Date(...)`, so nothing is converted here.
    expect(result.ok && (result.data.notes[0].createdAt as unknown)).toBe(
      '2026-01-01T10:00:00.000Z'
    )
  })
})

describe('preferences', () => {
  it('backfills notification defaults when the file predates them', () => {
    const result = validateBackup(
      file({}, { preferences: { theme: 'dark', userName: 'Ada' } }),
      replacing
    )

    expect(result.ok && result.data.preferences.notifications).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    )
  })

  it('does not switch a merged-into setting back on when the file is silent', () => {
    // currentPreferences has notifications disabled; the file says nothing.
    const result = validate(file({}, { preferences: { theme: 'dark' } }))

    expect(result.ok && result.data.preferences.notifications.enabled).toBe(false)
  })

  it('keeps notification settings the file does carry', () => {
    const result = validate(
      file(
        {},
        {
          preferences: {
            ...currentPreferences,
            notifications: { enabled: false, taskReminderLeadMinutes: 30 },
          },
        }
      )
    )

    expect(result.ok && result.data.preferences.notifications).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: false,
      taskReminderLeadMinutes: 30,
    })
  })

  it('falls back to the current value for a preference a merge cannot read', () => {
    const result = validate(
      file({}, { preferences: { theme: 'neon', dashboardLayout: 'spiral', userName: 7 } })
    )

    expect(result.ok && result.data.preferences.theme).toBe('dark')
    expect(result.ok && result.data.preferences.dashboardLayout).toBe('flex')
    expect(result.ok && result.data.preferences.userName).toBe('Ada')
  })

  it('merging a file with no preferences keeps the ones in force', () => {
    const result = validate(file({}, { preferences: undefined }))

    expect(result.ok && result.data.preferences).toEqual(currentPreferences)
  })

  it('replacing from a file with no preferences resets them to the defaults', () => {
    const result = validateBackup(file({}, { preferences: undefined }), replacing)

    expect(result.ok && result.data.preferences).toEqual(DEFAULT_PREFERENCES)
    expect(result.ok && result.data.preferences).not.toEqual(currentPreferences)
  })

  it('replacing fills only the fields a partial preferences block omits', () => {
    const result = validateBackup(
      file({}, { preferences: { userName: 'From the file' } }),
      replacing
    )

    expect(result.ok && result.data.preferences.userName).toBe('From the file')
    // Not 'dark' - the user's current theme is not inherited by a replace.
    expect(result.ok && result.data.preferences.theme).toBe(DEFAULT_PREFERENCES.theme)
    expect(result.ok && result.data.preferences.animationsEnabled).toBe(
      DEFAULT_PREFERENCES.animationsEnabled
    )
  })

  it('takes a readable preference from the file in either mode', () => {
    const preferences = { ...currentPreferences, theme: 'light', userName: 'Grace' }

    for (const options of [merging, replacing]) {
      const result = validateBackup(file({}, { preferences }), options)
      expect(result.ok && result.data.preferences.theme).toBe('light')
      expect(result.ok && result.data.preferences.userName).toBe('Grace')
    }
  })
})

describe('parseBackup', () => {
  it('refuses text that is not JSON', () => {
    const result = parseBackup('{ not json', merging)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('not valid JSON')
  })

  it('applies the same rules as validateBackup', () => {
    const result = parseBackup(JSON.stringify(file({ schemaVersion: 9 })), merging)

    expect(!result.ok && result.error).toContain('newer version of Bento')
  })
})

describe('round trip', () => {
  const exported: ExportableState = {
    widgets: [{ id: 'w1', type: 'notes', position: { x: 1, y: 2 }, size: 'large' }],
    notes: [
      {
        id: 'n1',
        content: 'round trip',
        color: 'blue',
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
        updatedAt: new Date('2026-01-03T10:00:00.000Z'),
      },
    ],
    tasks: [
      {
        id: 't1',
        title: 'come back',
        completed: true,
        priority: 'low',
        dueDate: new Date('2026-02-01T09:00:00.000Z'),
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
      },
    ],
    pomodoro: { timeLeft: 120, isRunning: true, mode: 'work', sessionsCompleted: 5 },
    preferences: { ...currentPreferences, userName: 'Ada', theme: 'dark' },
  }

  it('feeds export output straight back into import', () => {
    const text = serializeBackup(buildBackup(exported))

    const result = parseBackup(text, merging)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.notes).toHaveLength(1)
    expect(result.data.tasks[0].title).toBe('come back')
    expect(result.data.widgets[0].size).toBe('large')
    expect(result.data.pomodoro).toEqual({ sessionsCompleted: 5 })
    expect(result.data.preferences.userName).toBe('Ada')
  })

  it('round-trips twice to the same value', () => {
    const once = parseBackup(serializeBackup(buildBackup(exported)), merging)
    if (!once.ok) throw new Error('first pass should be valid')

    const twice = parseBackup(
      serializeBackup(buildBackup({ ...exported, ...once.data, pomodoro: exported.pomodoro })),
      merging
    )

    expect(twice.ok && twice.data).toEqual(once.data)
  })
})

describe('readBackupFile', () => {
  it('reads the text of a picked file', async () => {
    const text = serializeBackup(buildBackup({
      widgets: [],
      notes: [],
      tasks: [],
      pomodoro: { timeLeft: 1, isRunning: false, mode: 'work', sessionsCompleted: 0 },
      preferences: currentPreferences,
    }))

    const contents = await readBackupFile(
      new File([text], 'bento-backup.json', { type: 'application/json' })
    )

    expect(parseBackup(contents, merging).ok).toBe(true)
  })
})
