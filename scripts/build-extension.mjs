import { build, context } from 'esbuild'
import path from 'node:path'

const watch = process.argv.includes('--watch')
const options = {
  bundle: true,
  entryPoints: [path.resolve('src/extension/index.ts')],
  external: ['@earendil-works/pi-coding-agent'],
  format: 'esm',
  outfile: path.resolve('dist/extension/index.js'),
  platform: 'node',
  sourcemap: 'linked',
  target: 'node20',
}

if (watch) {
  const watcher = await context(options)
  await watcher.watch()
  process.stdout.write('Watching extension bundle…\n')
} else {
  await build(options)
}
