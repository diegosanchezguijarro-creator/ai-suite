// Installs each bundled app's own dependencies in place.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apps = ['orchestrator', 'aichatinterface']

let failed = false
for (const app of apps) {
  const dir = path.join(root, 'apps', app)
  if (!existsSync(path.join(dir, 'package.json'))) {
    console.error(`[setup] missing app: ${dir}`)
    failed = true
    continue
  }
  console.log(`[setup] npm install in apps/${app} ...`)
  const res = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) failed = true
}

if (failed) {
  console.error('[setup] one or more installs failed')
  process.exit(1)
}
console.log('[setup] all apps installed')
