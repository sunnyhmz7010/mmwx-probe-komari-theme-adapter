import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type ThemeSettings = Record<string, unknown>

function isRecord(value: unknown): value is ThemeSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseThemeSettingsJson(raw: string, source: string): ThemeSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${source} must be valid JSON`)
  }
  if (!isRecord(parsed)) throw new Error(`${source} must be a JSON object`)
  return parsed
}

export class FileThemeSettingsStore {
  public constructor(private readonly filePath: string) {}

  public async read(): Promise<ThemeSettings> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
    return parseThemeSettingsJson(raw, 'theme settings file')
  }

  public async write(settings: ThemeSettings): Promise<void> {
    if (!isRecord(settings)) throw new Error('theme settings must be a JSON object')
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  }
}
