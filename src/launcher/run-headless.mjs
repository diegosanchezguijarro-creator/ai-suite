import { runHeadless } from '../core.js'

const dataDirArg = process.argv.find((a) => a.startsWith('--data-dir='))
runHeadless({ dataDir: dataDirArg ? dataDirArg.split('=')[1] : undefined })
