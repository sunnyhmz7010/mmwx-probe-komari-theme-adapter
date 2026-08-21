export interface ThemeSource {
  repoUrl: string
  ref: string
}

export type PackageManager = 'pnpm' | 'bun' | 'npm' | 'none'

export interface BuildPlan {
  packageManager: PackageManager
  installArgs: readonly string[]
  buildArgs: readonly string[]
  outputCandidates: readonly string[]
}

export interface LoadedTheme {
  directory: string
  indexPath: string
  source: ThemeSource
}
