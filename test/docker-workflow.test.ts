import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

test('Docker workflow builds only v tags and publishes release image tags', async () => {
  const workflow = await readFile(path.join(process.cwd(), '.github', 'workflows', 'docker.yml'), 'utf8')

  assert.match(workflow, /push:\s*\n\s*tags:\s*\n\s*-\s*["']v\*["']/)
  assert.doesNotMatch(workflow, /push:\s*\n\s*branches:/)
  assert.doesNotMatch(workflow, /workflow_dispatch:/)
  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/)
  assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/)
  assert.match(workflow, /type=semver,pattern=\{\{major\}\}/)
  assert.match(workflow, /type=raw,value=latest/)
})

test('runtime Docker image enables pnpm for packageManager-declared themes', async () => {
  const dockerfile = await readFile(path.join(process.cwd(), 'Dockerfile'), 'utf8')

  assert.match(dockerfile, /corepack enable pnpm/)
})
