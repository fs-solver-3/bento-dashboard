export type WidgetType = 
  | 'clock'
  | 'weather'
  | 'notes'
  | 'pomodoro'
  | 'tasks'
  | 'quote'
  | 'calendar'
  | 'search';

export type WidgetSize = 'small' | 'medium' | 'large';

export interface Position {
  x: number;
  y: number;
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  position: Position;
  size: WidgetSize;
  settings?: Record<string, unknown>;
}

export interface Note {
  id: string;
  content: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  dueDate?: Date;
  createdAt: Date;
}

export interface PomodoroState {
  timeLeft: number;
  isRunning: boolean;
  mode: 'work' | 'shortBreak' | 'longBreak';
  sessionsCompleted: number;
}

export interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  location: string;
  icon: string;
}

export interface Quote {
  text: string;
  author: string;
  category: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface NotificationPreferences {
  /** Master switch for every notification the dashboard sends. */
  enabled: boolean;
  /** Notify when a focus session or break finishes. */
  pomodoro: boolean;
  /** Remind about tasks that are due. */
  tasks: boolean;
  /** How long before the due date a task reminder fires. */
  taskReminderLeadMinutes: number;
}

export interface UserPreferences {
  theme: ThemeMode;
  userName: string;
  dashboardLayout: 'grid' | 'flex';
  animationsEnabled: boolean;
  notifications: NotificationPreferences;
}

export interface PomodoroCompletion {
  completedMode: PomodoroState['mode'];
  nextMode: PomodoroState['mode'];
  at: number;
}

export interface DashboardState {
  widgets: WidgetConfig[];
  notes: Note[];
  tasks: Task[];
  pomodoro: PomodoroState;
  weather: WeatherData | null;
  preferences: UserPreferences;
  lastPomodoroCompletion: PomodoroCompletion | null;
}

/**
 * The pomodoro fields that survive a backup. `timeLeft`, `isRunning` and
 * `mode` describe a timer on one device at one moment, so they are never
 * written to a file and never read from one.
 */
export interface ExportedPomodoro {
  sessionsCompleted: number;
}

/** The five persisted slices, exactly as `partialize` defines them. */
export interface ExportedData {
  widgets: WidgetConfig[];
  notes: Note[];
  tasks: Task[];
  pomodoro: ExportedPomodoro;
  preferences: UserPreferences;
}

/** Versioned envelope written to disk by the export, read back by the import. */
export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  data: ExportedData;
}

/**
 * Replace wipes the five slices and installs the file.
 * Merge upserts records by `id`; the imported record wins.
 */
export type ImportMode = 'replace' | 'merge';

/**
 * What became of an import. `storage-full` means the browser refused to
 * persist the result; the dashboard was rolled back to what it was.
 */
export type ImportOutcome = { ok: true } | { ok: false; reason: 'storage-full' };
