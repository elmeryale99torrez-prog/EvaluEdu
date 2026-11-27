import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    const hadController = Boolean(navigator.serviceWorker.controller)
    let updateNotified = false

    const notifyUpdateReady = () => {
      if (updateNotified) return
      updateNotified = true
      window.dispatchEvent(new CustomEvent('evaluedu-app-update-ready'))
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        notifyUpdateReady()
      }
    })

    void navigator.serviceWorker
      .register(swUrl, { updateViaCache: 'none' })
      .then((registration) => {
        const checkForUpdates = () => {
          if (navigator.onLine) {
            void registration.update().catch(() => {})
          }
        }

        // Comprobar versión nueva al abrir, al volver a la pestaña/app, al reconectar y cada 10 min
        checkForUpdates()
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdates()
        })
        window.addEventListener('online', checkForUpdates)
        window.setInterval(() => {
          if (document.visibilityState === 'visible') checkForUpdates()
        }, 10 * 60 * 1000)

        if (registration.waiting && hadController) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' })
            }
          })
        })
      })
      .catch((error: unknown) => {
        console.warn('No se pudo registrar el service worker de EvaluEdu.', error)
      })
  })
}

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister()
    }
  })
}
