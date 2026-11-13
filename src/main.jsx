import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/question-routes.css'
import { useAppStore } from './store/appStore.js'
import { usePracticeStore } from './store/practiceStore.js'
import { useChatPracticeStore } from './store/chatPracticeStore.js'
import { createForegroundSignals } from './core/queue/foreground.js'
// 启动链诊断：只记录，不改行为。整个 diagnostics.js 可以直接删除。
import { record as diagRecord } from './core/queue/diagnostics.js'

// Start once outside React effects so StrictMode cannot open two writers.
let stopQueue;
let stopNative;
let disposed = false;
const stopDesktop = globalThis.mathmythDesktop?.onBeforeClose(() => useAppStore.getState().prepareForExit());
Promise.resolve(useAppStore.getState().initializeStorage()).catch((error) => {
  diagRecord('boot:storage:fail', (error?.name || 'Error') + ': ' + (error?.message ?? String(error)))
})

// 原来是一个 Promise.all([...]) 被 .catch(() => {}) 整个吞掉：只要有一个模块
// import 失败，就没人知道是哪一个，也看不出 startQueue 到底有没有被调用。
// 这里改成逐个 import 并分别记录，仍然"任何一个失败就不启动队列、不阻塞界面"。
const BOOT_MODULES = [
  ['runner', () => import('./core/queue/runner.js')],
  ['database', () => import('./core/db/database.js')],
  ['skeleton', () => import('./core/skeleton/load.js')],
]

async function bootQueue() {
  const loaded = {}
  for (const [name, load] of BOOT_MODULES) {
    try {
      loaded[name] = await load()
      diagRecord('boot:import:ok', name)
    } catch (error) {
      diagRecord('boot:import:fail', name + ' → ' + (error?.name || 'Error') + ': ' + (error?.message ?? String(error))
        + '\n' + String(error?.stack ?? '').slice(0, 500))
      return
    }
  }
  if (disposed) {
    diagRecord('boot:startQueue:skipped', 'disposed=true，启动过程中组件已被卸载')
    return
  }
  try {
    stopQueue = loaded.runner.startQueue({ store: useAppStore, database: loaded.database, getSkeleton: loaded.skeleton.loadSkeleton,
      ...createForegroundSignals(usePracticeStore, useChatPracticeStore),
    })
    diagRecord('boot:startQueue:called', typeof stopQueue === 'function' ? 'startQueue 返回了 stop 函数' : 'startQueue 没有返回 stop')
  } catch (error) {
    diagRecord('boot:startQueue:fail', (error?.name || 'Error') + ': ' + (error?.message ?? String(error))
      + '\n' + String(error?.stack ?? '').slice(0, 500))
  }
}
bootQueue()

// D11：返回前台的路由两条——原生走 Capacitor 的 appStateChange，网页与桌面端走
// visibilitychange。两者都只会触发"同一回答一次"的自动重连，重复注册也安全。
import('./core/platform/lifecycle.js')
  .then(({ startNativeLifecycle, startVisibilityLifecycle }) => {
    const stopVisibility = startVisibilityLifecycle();
    return startNativeLifecycle().then((stop) => () => { stop?.(); stopVisibility(); });
  })
  .then((stop) => { if (disposed) stop(); else stopNative = stop; })
  .catch(() => {})
if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true
  diagRecord('boot:dispose', 'import.meta.hot.dispose 触发，队列与原生监听被停掉')
  stopQueue?.(); stopNative?.(); stopDesktop?.()
})

// 更新检查：最多 14 天一次、失败静默、不阻塞启动。没有发布 Release 时 GitHub 回 404，
// 也当作"暂无更新"，不打扰任何东西。
import('./core/update/check.js')
  .then(({ autoCheck }) => import('./package-version.js').then(({ APP_VERSION }) => autoCheck({ current: APP_VERSION })))
  .catch(() => {})

// 性能探针：只有 ?perf=1 或 localStorage 里开了才真正安装，否则这个 import 直接 no-op。
import('./core/ui/perfProbe.js').then(({ installPerfProbe }) => installPerfProbe()).catch(() => {})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary scope="应用">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
