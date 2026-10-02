import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32' ? ['.cmd'] : ['']

function npmRun(args, cwd, label) {
  console.log(`[prepare:runtime] ${label}: npm ${args.join(' ')} ...`)
  const res = spawnSync(`npm${win[0]}`, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) {
    console.error(`[prepare:runtime] ${label} failed`)
    process.exit(res.status ?? 1)
  }
}

const apps = path.join(root, 'apps')

// 1. Installs every app's own deps
npmRun(['install', '--no-audit', '--no-fund'], path.join(apps, 'orchestrator'), 'install orchestrator')
npmRun(['install', '--no-audit', '--no-fund'], path.join(apps, 'aichatinterface'), 'install aichatinterface')

// 2. Builds the React static bundle for the chat interface
npmRun(['run', 'build'], path.join(apps, 'aichatinterface'), 'build aichatinterface dist')

// 3. Prunes devDependencies so the packaged app only ships what the server needs
npmRun(['prune', '--omit=dev'], path.join(apps, 'orchestrator'), 'prune orchestrator')
npmRun(['prune', '--omit=dev'], path.join(apps, 'aichatinterface'), 'prune aichatinterface')

const dist = path.join(apps, 'aichatinterface', 'dist')
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error(`[prepare:runtime] missing build output: ${dist}`)
  process.exit(1)
}
console.log('[prepare:runtime] done — apps ready for packaging or dev runs')
