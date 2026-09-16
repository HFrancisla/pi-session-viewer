import { rm } from 'node:fs/promises'
import path from 'node:path'

await rm(path.resolve(process.cwd(), 'dist'), { recursive: true, force: true })
