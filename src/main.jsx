import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/question-routes.css'
import { useAppStore } from './store/appStore.js'
import { usePracticeStore } from './store/practiceStore.js'

// Start once outside React effects so StrictMode cannot open two writers.
let stopQueue;
let stopNative;
let disposed = false;
const stopDesktop = globalThis.mathmythDesktop?.onBeforeClose(() => useAppStore.getState().prepareForExit());
Promise.resolve(useAppStore.getState().initializeStorage()).catch(() => {})
Promise.all([
  import('./core/queue/runner.js'), import('./core/db/database.js'), import('./core/skeleton/load.js'),
]).then(([{ startQueue }, database, { loadSkeleton }]) => {
  if (!disposed) stopQueue = startQueue({ store: useAppStore, database, getSkeleton: loadSkeleton,
    isForegroundBusy: () => { const state=usePracticeStore.getState();return state.generating || state.modelBusy },
    subscribeForeground: (listener) => usePracticeStore.subscribe((state,previous) => { if(state.generating!==previous.generating || state.modelBusy!==previous.modelBusy)listener() }),
  })
}).catch(() => {})
import('./core/platform/lifecycle.js').then(({ startNativeLifecycle }) => startNativeLifecycle()).then((stop) => { if (disposed) stop(); else stopNative = stop; }).catch(() => {})
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; stopQueue?.(); stopNative?.(); stopDesktop?.() })

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
