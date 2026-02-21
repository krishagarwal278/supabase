/**
 * Structured Logger
 *
 * Production-grade logging utility with:
 * - JSON format for production (machine-readable)
 * - Pretty format for development (human-readable)
 * - Request ID tracking
 * - Different log levels
 * - Context-aware logging
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Check if running in production (safe version that doesn't throw)
 */
function isProductionSafe(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Logger class with support for structured logging
 */
class Logger {
  private level: LogLevel = 'info';
  private context: LogContext = {};

  constructor() {
    // Use process.env directly to avoid circular dependency with env.ts
    const envLogLevel = process.env['LOG_LEVEL'] as LogLevel | undefined;
    if (envLogLevel && LOG_LEVELS[envLogLevel] !== undefined) {
      this.level = envLogLevel;
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.context = { ...this.context, ...context };
    childLogger.level = this.level;
    return childLogger;
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Check if a log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  /**
   * Format and output a log entry
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    // Merge context
    if (Object.keys(this.context).length > 0 || data) {
      entry.context = { ...this.context, ...data };

      // Extract error if present
      const errorFromData = data?.['error'];
      if (errorFromData instanceof Error) {
        entry.error = {
          name: errorFromData.name,
          message: errorFromData.message,
        };
        if (errorFromData.stack) {
          entry.error.stack = errorFromData.stack;
        }
        const { error: _, ...rest } = entry.context;
        entry.context = rest;
      }
    }

    // Output format based on environment (use safe version that doesn't require env initialization)
    const output = isProductionSafe() ? this.formatJSON(entry) : this.formatPretty(entry);

    // Use appropriate console method
    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  /**
   * Format log entry as JSON (for production)
   */
  private formatJSON(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * Format log entry for human readability (for development)
   */
  private formatPretty(entry: LogEntry): string {
    const colors = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m', // green
      warn: '\x1b[33m', // yellow
      error: '\x1b[31m', // red
      reset: '\x1b[0m',
      dim: '\x1b[2m',
    };

    const levelColor = colors[entry.level];
    const timestamp = colors.dim + entry.timestamp + colors.reset;
    const level = levelColor + entry.level.toUpperCase().padEnd(5) + colors.reset;

    let output = `${timestamp} ${level} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${colors.dim}${JSON.stringify(entry.context)}${colors.reset}`;
    }

    if (entry.error) {
      output += `\n${colors.error}${entry.error.stack || entry.error.message}${colors.reset}`;
    }

    return output;
  }

  // Log level methods
  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for creating child loggers
export { Logger };

// Export type for use in other modules
export type { LogContext, LogLevel };
