// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run build` -> production build for Hostinger (BrowserRouter, absolute paths).
// `npm run build:preview` -> relative paths + HashRouter so it runs from any folder/host.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'preview' ? './' : '/',
}))
