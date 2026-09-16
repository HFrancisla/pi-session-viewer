import { build } from 'esbuild'
import path from 'node:path'

await build({
  bundle: true,
  entryPoints: [path.resolve('src/server/standalone.ts')],
  external: [],
  format: 'esm',
  outfile: path.resolve('dist/standalone/index.js'),
  platform: 'node',
  sourcemap: 'linked',
  target: 'node20',
})
