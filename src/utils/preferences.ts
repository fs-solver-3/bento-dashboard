import type { UserPreferences } from '../types'
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notifications'

/**
 * The preferences a fresh dashboard starts with.
 *
 * Lives here rather than in the store because two callers need it: the store
 * uses it as its initial state, and a replace-mode import falls back to it for
 * anything the backup file does not carry.
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  userName: 'User',
  dashboardLayout: 'grid',
  animationsEnabled: true,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
}
