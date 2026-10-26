import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { useDashboardStore } from '../src/store/dashboardStore'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/utils/notifications'
import type { ExportedData, Note, Task, UserPreferences, WidgetConfig } from '../src/types'

const preferences: UserPreferences = {
  theme: 'light',
  userName: 'Ada',
  dashboardLayout: 'grid',
  animationsEnabled: true,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
}

const note = (id: string, content: string): Note => ({
  id,
  content,
  color: 'yellow',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T10:00:00.000Z'),
})

const task = (id: string, title: string): Task => ({
  id,
  title,
  completed: false,
  priority: 'medium',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
})

const widget = (id: string): WidgetConfig => ({
  id,
  type: 'clock',
  position: { x: 0, y: 0 },
  size: 'medium',
})

const backup = (overrides: Partial<ExportedData> = {}): ExportedData => ({
  widgets: [widget('w-imported')],
  notes: [note('n-imported', 'from the file')],
  tasks: [task('t-imported', 'from the file')],
  pomodoro: { sessionsCompleted: 9 },
  preferences: { ...preferences, userName: 'Imported Ada', theme: 'dark' },
  ...overrides,
})

describe('importData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDashboardStore.setState({
      widgets: [widget('w-local')],
      notes: [note('n-local', 'already here')],
      tasks: [task('t-local', 'already here')],
      pomodoro: { timeLeft: 742, isRunning: true, mode: 'shortBreak', sessionsCompleted: 4 },
      preferences,
    })
  })

  describe('replace', () => {
    it('installs the file and discards what was there', () => {
      useDashboardStore.getState().importData(backup(), 'replace')

      const state = useDashboardStore.getState()
      expect(state.notes.map((n) => n.id)).toEqual(['n-imported'])
      expect(state.tasks.map((t) => t.id)).toEqual(['t-imported'])
      expect(state.widgets.map((w) => w.id)).toEqual(['w-imported'])
    })

    it('takes the session tally and the preferences from the file', () => {
      useDashboardStore.getState().importData(backup(), 'replace')

      const state = useDashboardStore.getState()
      expect(state.pomodoro.sessionsCompleted).toBe(9)
      expect(state.preferences.userName).toBe('Imported Ada')
      expect(state.preferences.theme).toBe('dark')
    })

    it('empties a slice the file has nothing in', () => {
      useDashboardStore.getState().importData(backup({ notes: [] }), 'replace')

      expect(useDashboardStore.getState().notes).toEqual([])
    })
  })

  describe('merge', () => {
    it('keeps local records and adds the imported ones', () => {
      useDashboardStore.getState().importData(backup(), 'merge')

      const state = useDashboardStore.getState()
      expect(state.notes.map((n) => n.id)).toEqual(['n-local', 'n-imported'])
      expect(state.tasks.map((t) => t.id)).toEqual(['t-local', 't-imported'])
      expect(state.widgets.map((w) => w.id)).toEqual(['w-local', 'w-imported'])
    })

    it('lets the imported record win on a matching id, without regenerating it', () => {
      useDashboardStore.getState().importData(
        backup({ notes: [note('n-local', 'the file version')] }),
        'merge'
      )

      const state = useDashboardStore.getState()
      expect(state.notes).toHaveLength(1)
      expect(state.notes[0].id).toBe('n-local')
      expect(state.notes[0].content).toBe('the file version')
    })

    it('is a no-op when the same file is imported twice', () => {
      const file = backup()
      const store = useDashboardStore.getState()

      store.importData(file, 'merge')
      const afterFirst = useDashboardStore.getState()
      const snapshot = {
        widgets: afterFirst.widgets,
        notes: afterFirst.notes,
        tasks: afterFirst.tasks,
        pomodoro: afterFirst.pomodoro,
        preferences: afterFirst.preferences,
      }

      store.importData(file, 'merge')
      const afterSecond = useDashboardStore.getState()

      expect(afterSecond.widgets).toEqual(snapshot.widgets)
      expect(afterSecond.notes).toEqual(snapshot.notes)
      expect(afterSecond.tasks).toEqual(snapshot.tasks)
      expect(afterSecond.pomodoro).toEqual(snapshot.pomodoro)
      expect(afterSecond.preferences).toEqual(snapshot.preferences)
    })

    it('takes the pomodoro tally from the file, even when it is lower', () => {
      // Not id-keyed, so the imported value wins - the same rule as a matching
      // record, including when it lowers the tally from 4 to 1.
      useDashboardStore.getState().importData(backup({ pomodoro: { sessionsCompleted: 1 } }), 'merge')

      expect(useDashboardStore.getState().pomodoro.sessionsCompleted).toBe(1)

      useDashboardStore.getState().importData(backup({ pomodoro: { sessionsCompleted: 11 } }), 'merge')

      expect(useDashboardStore.getState().pomodoro.sessionsCompleted).toBe(11)
    })

    it('takes each preference from the file', () => {
      useDashboardStore.getState().importData(backup(), 'merge')

      expect(useDashboardStore.getState().preferences.userName).toBe('Imported Ada')
      expect(useDashboardStore.getState().preferences.theme).toBe('dark')
    })
  })

  describe('when the browser cannot store the result', () => {
    const quotaError = () => {
      const error = new Error('exceeded the quota')
      error.name = 'QuotaExceededError'
      return error
    }

    const failNextWrite = (error: Error = quotaError()) => {
      const setItem = window.localStorage.setItem as unknown as Mock
      setItem.mockImplementationOnce(() => {
        throw error
      })
      return setItem
    }

    beforeEach(() => {
      ;(window.localStorage.setItem as unknown as Mock).mockReset()
    })

    it('reports the failure instead of throwing', () => {
      failNextWrite()

      const outcome = useDashboardStore.getState().importData(backup(), 'replace')

      expect(outcome).toEqual({ ok: false, reason: 'storage-full' })
    })

    it.each(['replace', 'merge'] as const)(
      'leaves every slice exactly as it was after a failed %s',
      (mode) => {
        const before = useDashboardStore.getState()
        const untouched = {
          widgets: before.widgets,
          notes: before.notes,
          tasks: before.tasks,
          pomodoro: before.pomodoro,
          preferences: before.preferences,
        }
        failNextWrite()

        const outcome = useDashboardStore.getState().importData(backup(), mode)

        const after = useDashboardStore.getState()
        expect(outcome.ok).toBe(false)
        expect(after.widgets).toEqual(untouched.widgets)
        expect(after.notes).toEqual(untouched.notes)
        expect(after.tasks).toEqual(untouched.tasks)
        expect(after.pomodoro).toEqual(untouched.pomodoro)
        expect(after.preferences).toEqual(untouched.preferences)
      }
    )

    it('rewrites the rolled-back state so storage and memory agree', () => {
      const setItem = failNextWrite()

      useDashboardStore.getState().importData(backup(), 'replace')

      // The failed write, then the put-back.
      expect(setItem).toHaveBeenCalledTimes(2)
      const lastWrite = JSON.parse(setItem.mock.calls[1][1] as string)
      expect(lastWrite.state.notes.map((n: { id: string }) => n.id)).toEqual(['n-local'])
    })

    it('still succeeds on the next try once there is room', () => {
      failNextWrite()
      useDashboardStore.getState().importData(backup(), 'replace')

      const outcome = useDashboardStore.getState().importData(backup(), 'replace')

      expect(outcome).toEqual({ ok: true })
      expect(useDashboardStore.getState().notes.map((n) => n.id)).toEqual(['n-imported'])
    })

    it('rolls back and rethrows an error that is not about storage space', () => {
      const before = useDashboardStore.getState().notes
      failNextWrite(new TypeError('something else entirely'))

      expect(() => useDashboardStore.getState().importData(backup(), 'replace')).toThrow(
        'something else entirely'
      )
      expect(useDashboardStore.getState().notes).toEqual(before)
    })
  })

  describe('the running timer', () => {
    it.each(['replace', 'merge'] as const)('is untouched by a %s import', (mode) => {
      const before = useDashboardStore.getState().pomodoro

      useDashboardStore.getState().importData(backup(), mode)

      const after = useDashboardStore.getState().pomodoro
      expect(after.isRunning).toBe(before.isRunning)
      expect(after.timeLeft).toBe(before.timeLeft)
      expect(after.mode).toBe(before.mode)
    })
  })

  describe('notification preferences', () => {
    it.each(['replace', 'merge'] as const)(
      'are backfilled with the defaults on a %s import',
      (mode) => {
        const withoutNotifications = {
          ...backup().preferences,
          notifications: undefined as unknown as UserPreferences['notifications'],
        }

        useDashboardStore
          .getState()
          .importData(backup({ preferences: withoutNotifications }), mode)

        expect(useDashboardStore.getState().preferences.notifications).toEqual(
          DEFAULT_NOTIFICATION_PREFERENCES
        )
      }
    )

    it('keeps the settings the file carries', () => {
      const prefs = {
        ...backup().preferences,
        notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false },
      }

      useDashboardStore.getState().importData(backup({ preferences: prefs }), 'merge')

      expect(useDashboardStore.getState().preferences.notifications.enabled).toBe(false)
    })
  })

  describe('slices that are not user data', () => {
    it('leaves weather and the last pomodoro completion alone', () => {
      useDashboardStore.setState({
        weather: {
          temperature: 12,
          condition: 'Cloudy',
          humidity: 80,
          windSpeed: 4,
          location: 'Here',
          icon: 'cloud',
        },
        lastPomodoroCompletion: { completedMode: 'work', nextMode: 'shortBreak', at: 1 },
      })

      useDashboardStore.getState().importData(backup(), 'replace')

      const state = useDashboardStore.getState()
      expect(state.weather?.location).toBe('Here')
      expect(state.lastPomodoroCompletion?.at).toBe(1)
    })
  })
})
