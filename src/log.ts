export type LogContext = Record<string, string | number | boolean | null | undefined>

export interface Logger {
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
}

function formatContext(context: LogContext, secrets: readonly string[]): string {
  const entries = Object.entries(context)
    .filter(([key, value]) => value !== undefined && key.toLowerCase() !== 'probetoken' && key.toLowerCase() !== 'token')
    .map(([key, value]) => `${key}=${redactSecrets(String(value), secrets)}`)
  return entries.length > 0 ? ` ${entries.join(' ')}` : ''
}

export function redactSecrets(message: string, secrets: readonly string[] = []): string {
  return secrets.reduce((result, secret) => secret ? result.split(secret).join('[REDACTED]') : result, message)
}

function write(level: 'info' | 'warn' | 'error', message: string, context: LogContext, secrets: readonly string[]): void {
  const output = `[${new Date().toISOString()}] [${level}] ${redactSecrets(message, secrets)}${formatContext(context, secrets)}`
  if (level === 'error') {
    console.error(output)
  } else if (level === 'warn') {
    console.warn(output)
  } else {
    console.info(output)
  }
}

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export function createLogger(secrets: readonly string[] = []): Logger {
  return {
    info: (message, context = {}) => write('info', message, context, secrets),
    warn: (message, context = {}) => write('warn', message, context, secrets),
    error: (message, context = {}) => write('error', message, context, secrets),
  }
}

export function logInfo(message: string, context: LogContext = {}, secrets: readonly string[] = []): void {
  write('info', message, context, secrets)
}

export function logError(message: string, context: LogContext = {}, secrets: readonly string[] = []): void {
  write('error', message, context, secrets)
}
