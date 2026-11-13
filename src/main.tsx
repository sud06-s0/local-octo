// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { markAppHealthy, reloadOnce } from './lib/lazyPage'

// Vite fires this when a page file can't be loaded (usually right after a new deploy)
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadOnce()
})
// Once the app has run fine for a bit, allow a future deploy to trigger one reload again
setTimeout(markAppHealthy, 15_000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
