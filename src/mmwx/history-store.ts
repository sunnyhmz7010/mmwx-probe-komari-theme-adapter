import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ProbeHistoryBuffer } from './history-buffer.js'

/**
 * ProbeHistoryBuffer 的 JSON 落盘存储：定时与停机时把缓冲快照写入运行目录，
 * 启动时恢复，消除进程重启后的历史空窗。写入采用临时文件 + 重命名的原子替换。
 */
export class FileHistoryBufferStore {
  public constructor(private readonly filePath: string) {}

  public async restore(buffer: ProbeHistoryBuffer): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    buffer.load(JSON.parse(raw))
  }

  public async flush(buffer: ProbeHistoryBuffer): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(buffer.toJSON()), 'utf8')
    await rename(tempPath, this.filePath)
  }

  // 停机路径使用同步写：进程退出前不依赖异步回调完成。
  public flushSync(buffer: ProbeHistoryBuffer): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(buffer.toJSON()), 'utf8')
    renameSync(tempPath, this.filePath)
  }
}
