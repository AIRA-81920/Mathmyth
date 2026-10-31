import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/question-routes.css'
import { useAppStore } from './store/appStore.js'
import { usePracticeStore } from './store/practiceStore.js'
import { useChatPracticeStore } from './store/chatPracticeStore.js'
import { createForegroundSignals } from './core/queue/foreground.js'

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
    ...createForegroundSignals(usePracticeStore, useChatPracticeStore),
  })
}).catch(() => {})
// D11：返回前台的路由两条——原生走 Capacitor 的 appStateChange，网页与桌面端走
// visibilitychange。两者都只会触发"同一回答一次"的自动重连，重复注册也安全。
import('./core/platform/lifecycle.js')
  .then(({ startNativeLifecycle, startVisibilityLifecycle }) => {
    const stopVisibility = startVisibilityLifecycle();
    return startNativeLifecycle().then((stop) => () => { stop?.(); stopVisibility(); });
  })
  .then((stop) => { if (disposed) stop(); else stopNative = stop; })
  .catch(() => {})
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; stopQueue?.(); stopNative?.(); stopDesktop?.() })

// 更新检查：最多 14 天一次、失败静默、不阻塞启动。没有发布 Release 时 GitHub 回 404，
// 也当作"暂无更新"，不打扰任何东西。
import('./core/update/check.js')
  .then(({ autoCheck }) => import('./package-version.js').then(({ APP_VERSION }) => autoCheck({ current: APP_VERSION })))
  .catch(() => {})

// 性能探针：只有 ?perf=1 或 localStorage 里开了才真正安装，否则这个 import 直接 no-op。
import('./core/ui/perfProbe.js').then(({ installPerfProbe }) => installPerfProbe()).catch(() => {})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
