// Copies each app's .env.example to .env on first run (does not overwrite).
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const app of ['orchestrator', 'aichatinterface']) {
  const dir = path.join(root, 'apps', app)
  const example = path.join(dir, '.env.example')
  const target = path.join(dir, '.env')
  if (existsSync(target)) {
    console.log(`[env] apps/${app}/.env already exists — keeping it`)
  } else if (existsSync(example)) {
    copyFileSync(example, target)
    console.log(`[env] created apps/${app}/.env from .env.example`)
  } else {
    console.warn(`[env] no .env.example found for ${app}`)
  }
}
