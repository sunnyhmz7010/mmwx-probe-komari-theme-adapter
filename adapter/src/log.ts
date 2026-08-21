export type LogContext = Record<string, string | number | boolean | null | undefined>

function formatContext(context: LogContext): string {
  const entries = Object.entries(context)
    .filter(([key, value]) => value !== undefined && key.toLowerCase() !== 'probetoken' && key.toLowerCase() !== 'token')
    .map(([key, value]) => `${key}=${String(value)}`)
  return entries.length > 0 ? ` ${entries.join(' ')}` : ''
}

export function redactSecrets(message: string, secrets: readonly string[] = []): string {
  return secrets.reduce((result, secret) => secret ? result.split(secret).join('[REDACTED]') : result, message)
}

export function logInfo(message: string, context: LogContext = {}): void {
  console.info(`[info] ${redactSecrets(message)}${formatContext(context)}`)
}

export function logError(message: string, context: LogContext = {}): void {
  console.error(`[error] ${redactSecrets(message)}${formatContext(context)}`)
}
