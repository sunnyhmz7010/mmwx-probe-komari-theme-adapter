import { describeConfig, loadConfig } from './config.js'
import { MmwxClient } from './mmwx/client.js'
import { createApiRouter } from './http/api.js'
import { createHttpServer, type ServerHandle } from './http/server.js'
import { KomariDataService } from './komari/service.js'
import { createLogger, logError, logInfo } from './log.js'
import { loadTheme } from './theme/loader.js'

export async function start(): Promise<ServerHandle> {
  const config = loadConfig(process.env)
  const logger = createLogger([config.probeToken])
  logger.info(`启动配置：${describeConfig(config)}`)
  const theme = await loadTheme(config, logger)
  const mmwx = new MmwxClient(config)
  const service = new KomariDataService(mmwx, config.cacheTtlMs, {
    ...theme.source,
    themeShort: theme.short,
    themeSettings: theme.themeSettings,
  })
  const api = createApiRouter(service)
  const server = createHttpServer(config, theme, api, mmwx)
  await server.listen()
  return server
}

async function run(): Promise<void> {
  const server = await start()
  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    logInfo(`received ${signal}, shutting down`)
    await server.close()
    process.exitCode = 0
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    logError('MMWX Komari adapter failed to start', {
      reason: error instanceof Error ? error.message : 'unknown error',
    })
    process.exitCode = 1
  })
}
import { pathToFileURL } from 'node:url'
