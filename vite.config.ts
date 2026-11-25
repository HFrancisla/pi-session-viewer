import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { loadVanillaBaseline } from './server/vanilla-baseline.ts'

export default defineConfig(async () => ({
  plugins: [react()],
  define: { __PI_VANILLA_BASELINE__: JSON.stringify(await loadVanillaBaseline()) },
}))
