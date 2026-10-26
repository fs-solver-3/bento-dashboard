import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  REVOKE_DELAY_MS,
  SCHEMA_VERSION,
  backupFileName,
  buildBackup,
  describeBackup,
  downloadBackup,
  serializeBackup,
  type ExportableState,
} from '../src/utils/export'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/utils/notifications'

const state = (overrides: Partial<ExportableState> = {}): ExportableState => ({
  widgets: [{ id: 'w1', type: 'clock', position: { x: 0, y: 0 }, size: 'medium' }],
  notes: [
    {
      id: 'n1',
      content: 'Remember the milk',
      color: 'yellow',
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-02T10:00:00.000Z'),
    },
  ],
  tasks: [
    {
      id: 't1',
      title: 'Ship the backup feature',
      completed: false,
      priority: 'high',
      dueDate: new Date('2026-02-01T09:00:00.000Z'),
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
    },
  ],
  pomodoro: { timeLeft: 742, isRunning: true, mode: 'shortBreak', sessionsCompleted: 7 },
  preferences: {
    theme: 'dark',
    userName: 'Ada',
    dashboardLayout: 'grid',
    animationsEnabled: false,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  },
  ...overrides,
})

describe('buildBackup', () => {
  it('wraps the data in a versioned envelope', () => {
    const backup = buildBackup(state(), new Date('2026-03-04T05:06:07.000Z'))

    expect(backup.schemaVersion).toBe(SCHEMA_VERSION)
    expect(backup.exportedAt).toBe('2026-03-04T05:06:07.000Z')
  })

  it('carries all five persisted slices', () => {
    const backup = buildBackup(state())

    expect(Object.keys(backup.data).sort()).toEqual([
      'notes',
      'pomodoro',
      'preferences',
      'tasks',
      'widgets',
    ])
  })

  it('exports only the pomodoro session tally', () => {
    const backup = buildBackup(state())

    expect(backup.data.pomodoro).toEqual({ sessionsCompleted: 7 })
    expect(Object.keys(backup.data.pomodoro)).not.toContain('timeLeft')
    expect(Object.keys(backup.data.pomodoro)).not.toContain('isRunning')
    expect(Object.keys(backup.data.pomodoro)).not.toContain('mode')
  })

  it('never leaks a running timer into the file', () => {
    const json = serializeBackup(buildBackup(state()))

    expect(json).not.toContain('isRunning')
    expect(json).not.toContain('timeLeft')
  })
})

describe('serializeBackup', () => {
  it('produces JSON that parses back to the same envelope', () => {
    const backup = buildBackup(state(), new Date('2026-03-04T05:06:07.000Z'))

    const reparsed = JSON.parse(serializeBackup(backup))

    expect(reparsed.schemaVersion).toBe(1)
    expect(reparsed.data.notes[0].content).toBe('Remember the milk')
  })

  it('writes Date fields as ISO strings', () => {
    const reparsed = JSON.parse(serializeBackup(buildBackup(state())))

    expect(reparsed.data.notes[0].createdAt).toBe('2026-01-01T10:00:00.000Z')
    expect(reparsed.data.tasks[0].dueDate).toBe('2026-02-01T09:00:00.000Z')
  })
})

describe('backupFileName', () => {
  it('names the file after the day it was taken', () => {
    expect(backupFileName(new Date('2026-10-26T23:30:00.000Z'))).toBe('bento-backup-2026-10-26.json')
  })
})

describe('describeBackup', () => {
  it('counts what is in the file', () => {
    expect(describeBackup(buildBackup(state()).data)).toBe('1 note, 1 task, 1 widget')
  })

  it('pluralises', () => {
    const empty = buildBackup(state({ widgets: [], notes: [], tasks: [] })).data

    expect(describeBackup(empty)).toBe('0 notes, 0 tasks, 0 widgets')
  })
})

/** jsdom's Blob has no `.text()`, so read it the way a browser would. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('downloadBackup', () => {
  const blobs: Blob[] = []
  const revokeObjectURL = vi.fn()
  let clicked: { download: string } | null = null

  beforeEach(() => {
    blobs.length = 0
    clicked = null
    revokeObjectURL.mockClear()
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:bento'
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      const anchor = document.querySelector('a[download]') as HTMLAnchorElement | null
      clicked = anchor ? { download: anchor.download } : null
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands the browser a json blob under a dated filename', () => {
    downloadBackup(state(), new Date('2026-10-26T00:00:00.000Z'))

    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe('application/json')
    expect(clicked).toEqual({ download: 'bento-backup-2026-10-26.json' })
  })

  it('leaves no anchor behind', () => {
    downloadBackup(state())

    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  it('releases the blob url, but not until the download has started', () => {
    vi.useFakeTimers()
    try {
      downloadBackup(state())

      // Revoking in the same tick as the click cancels the download in
      // Firefox and Safari, so nothing may be revoked yet.
      expect(revokeObjectURL).not.toHaveBeenCalled()

      vi.advanceTimersByTime(REVOKE_DELAY_MS)

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:bento')
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes the same envelope it returns', async () => {
    const returned = downloadBackup(state())

    expect(JSON.parse(await readBlob(blobs[0]))).toEqual(JSON.parse(JSON.stringify(returned)))
  })
})
