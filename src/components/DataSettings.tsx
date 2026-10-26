import { useRef, useState } from 'react'
import { AlertCircle, Check, Download, Upload } from 'lucide-react'
import { useDashboardStore } from '../store/dashboardStore'
import { describeBackup, downloadBackup } from '../utils/export'
import { parseBackup, readBackupFile, type ImportSuccess } from '../utils/import'
import type { ImportMode, ImportOutcome } from '../types'

type Status = { tone: 'success' | 'error'; message: string } | null

/**
 * Backup and restore, entirely on this machine: the export hands the browser a
 * file, the import reads one the user picks. No network, no server.
 *
 * Replace is destructive, so it asks for confirmation once the file has been
 * validated. Merge applies straight away - it only ever adds or updates.
 */
export function DataSettings() {
  const { widgets, notes, tasks, pomodoro, preferences, importData } = useDashboardStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [status, setStatus] = useState<Status>(null)
  const [pending, setPending] = useState<ImportSuccess | null>(null)

  /**
   * A validated file is tied to the mode it was read for, so switching modes
   * throws away a pending confirmation rather than replaying it under rules
   * it was not checked against.
   */
  const chooseMode = (next: ImportMode) => {
    setMode(next)
    setPending(null)
    setStatus(null)
  }

  const handleExport = () => {
    try {
      downloadBackup({ widgets, notes, tasks, pomodoro, preferences })
      setStatus({ tone: 'success', message: 'Backup saved to your downloads.' })
    } catch {
      setStatus({ tone: 'error', message: 'Your browser blocked the download.' })
    }
    setPending(null)
  }

  /**
   * The single point where imported data reaches the store. Either outcome
   * leaves the dashboard consistent: on a storage failure the store has
   * already rolled itself back, so there is nothing to undo here.
   */
  const apply = (data: ImportSuccess['data'], applyMode: ImportMode) => {
    let outcome: ImportOutcome
    try {
      outcome = importData(data, applyMode)
    } catch {
      setStatus({
        tone: 'error',
        message: 'This backup could not be imported. Nothing on your dashboard was changed.',
      })
      return
    }

    if (!outcome.ok) {
      setStatus({
        tone: 'error',
        message:
          "There isn't enough room in this browser's storage for that backup. Nothing on your dashboard was changed.",
      })
      return
    }

    setStatus({
      tone: 'success',
      message:
        applyMode === 'merge'
          ? `Merged in ${describeBackup(data)}.`
          : `Replaced everything with ${describeBackup(data)}.`,
    })
  }

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clearing the input lets the user pick the same file again after a failure.
    event.target.value = ''
    if (!file) return

    setStatus(null)
    setPending(null)

    let text: string
    try {
      text = await readBackupFile(file)
    } catch {
      setStatus({ tone: 'error', message: 'This file could not be read.' })
      return
    }

    const result = parseBackup(text, { mode, currentPreferences: preferences })
    if (!result.ok) {
      // Nothing has been written at this point, so the dashboard is untouched.
      setStatus({ tone: 'error', message: result.error })
      return
    }

    if (mode === 'replace') {
      setPending(result)
      return
    }

    apply(result.data, 'merge')
  }

  const confirmReplace = () => {
    if (!pending) return
    apply(pending.data, 'replace')
    setPending(null)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Download className="w-4 h-4 text-primary-500" />
        <span className="text-sm font-medium">Backup &amp; restore</span>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Save your notes, tasks, widgets and preferences to a file on this device, or restore them
        from one. Nothing is uploaded anywhere.
      </p>

      <button onClick={handleExport} className="btn-primary text-xs mb-4">
        Export backup
      </button>

      <div className="space-y-2">
        <span className="block text-xs text-gray-500 dark:text-gray-400">When importing</span>

        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="import-mode"
            value="merge"
            checked={mode === 'merge'}
            onChange={() => chooseMode('merge')}
            className="mt-0.5 w-4 h-4 border-gray-300 text-primary-500 focus:ring-primary-500"
          />
          <span className="text-sm">
            Merge
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Keeps what is here and adds the file on top.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="import-mode"
            value="replace"
            checked={mode === 'replace'}
            onChange={() => chooseMode('replace')}
            className="mt-0.5 w-4 h-4 border-gray-300 text-primary-500 focus:ring-primary-500"
          />
          <span className="text-sm">
            Replace
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              Discards what is here and installs the file instead.
            </span>
          </span>
        </label>
      </div>

      <input
        ref={fileInputRef}
        id="import-backup-file"
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
        className="sr-only"
        aria-label="Choose a backup file"
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="btn-primary text-xs mt-3 inline-flex items-center gap-1"
      >
        <Upload className="w-3 h-3" /> Import backup
      </button>

      {pending && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-xs">
          <p className="mb-2">
            Replace everything on this dashboard with {describeBackup(pending.data)} from this file?
            Your current notes and tasks will be gone.
          </p>
          <div className="flex gap-2">
            <button onClick={confirmReplace} className="btn-primary text-xs">
              Replace everything
            </button>
            <button
              onClick={() => setPending(null)}
              className="text-xs px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-1 text-xs ${
            status.tone === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-green-600 dark:text-green-400'
          }`}
        >
          {status.tone === 'error' ? (
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          ) : (
            <Check className="w-3 h-3 mt-0.5 shrink-0" />
          )}
          {status.message}
        </p>
      )}
    </div>
  )
}
