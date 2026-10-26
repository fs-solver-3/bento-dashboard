import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDashboardStore } from '../src/store/dashboardStore'
import { DataSettings } from '../src/components/DataSettings'
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/utils/notifications'
import { buildBackup, serializeBackup, type ExportableState } from '../src/utils/export'

vi.mock('../src/store/dashboardStore', () => ({
  useDashboardStore: vi.fn(),
}))

const mockedStore = useDashboardStore as unknown as ReturnType<typeof vi.fn>
const mockImport = vi.fn()

const storeState: ExportableState = {
  widgets: [{ id: 'w1', type: 'clock', position: { x: 0, y: 0 }, size: 'medium' }],
  notes: [
    {
      id: 'n1',
      content: 'already here',
      color: 'yellow',
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-01T10:00:00.000Z'),
    },
  ],
  tasks: [],
  pomodoro: { timeLeft: 300, isRunning: true, mode: 'work', sessionsCompleted: 2 },
  preferences: {
    theme: 'light',
    userName: 'Ada',
    dashboardLayout: 'grid',
    animationsEnabled: true,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  },
}

function backupFile(contents: string = serializeBackup(buildBackup(storeState))) {
  return new File([contents], 'bento-backup.json', { type: 'application/json' })
}

describe('DataSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedStore.mockReturnValue({ ...storeState, importData: mockImport })
    URL.createObjectURL = vi.fn(() => 'blob:bento') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports a backup when asked', async () => {
    render(<DataSettings />)

    await userEvent.click(screen.getByRole('button', { name: /export backup/i }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/backup saved/i)).toBeInTheDocument()
  })

  it('merges by default and reports what it merged', async () => {
    render(<DataSettings />)

    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile())

    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1))
    expect(mockImport.mock.calls[0][1]).toBe('merge')
    expect(await screen.findByText(/merged in 1 note, 0 tasks, 1 widget/i)).toBeInTheDocument()
  })

  it('asks before replacing, and only then replaces', async () => {
    render(<DataSettings />)

    await userEvent.click(screen.getByRole('radio', { name: /replace/i }))
    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile())

    expect(await screen.findByText(/replace everything on this dashboard/i)).toBeInTheDocument()
    expect(mockImport).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^replace everything$/i }))

    expect(mockImport).toHaveBeenCalledTimes(1)
    expect(mockImport.mock.calls[0][1]).toBe('replace')
  })

  it('changes nothing when the replace confirmation is cancelled', async () => {
    render(<DataSettings />)

    await userEvent.click(screen.getByRole('radio', { name: /replace/i }))
    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile())
    await screen.findByText(/replace everything on this dashboard/i)

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockImport).not.toHaveBeenCalled()
    expect(screen.queryByText(/replace everything on this dashboard/i)).not.toBeInTheDocument()
  })

  it('refuses a file with no schema version and leaves the data alone', async () => {
    const noVersion = JSON.stringify({ data: { notes: [], tasks: [], widgets: [] } })

    render(<DataSettings />)
    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile(noVersion))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no schema version/i)
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('refuses a file from a newer Bento with its own message', async () => {
    const newer = JSON.stringify({ ...buildBackup(storeState), schemaVersion: 99 })

    render(<DataSettings />)
    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile(newer))

    expect(await screen.findByRole('alert')).toHaveTextContent(/newer version of Bento/i)
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('refuses a file that is not JSON at all', async () => {
    render(<DataSettings />)

    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile('nonsense'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i)
    expect(mockImport).not.toHaveBeenCalled()
  })

  it('never writes to the store itself', async () => {
    render(<DataSettings />)

    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), backupFile())

    await waitFor(() => expect(mockImport).toHaveBeenCalled())
    // Everything the component changes goes through the one store action.
    expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({ notes: expect.any(Array) }), 'merge')
  })
})
