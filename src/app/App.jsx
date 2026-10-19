import { useEffect, useRef } from 'react'
import { Menu, Plus } from 'lucide-react'
import { useAppStore } from '../store/appStore.js'
import Onboarding from '../pages/Onboarding.jsx'
import Settings from '../pages/Settings.jsx'
import Ask from '../pages/Ask.jsx'
import Practice from '../pages/Practice.jsx'
import Trail from '../pages/Trail.jsx'
import Method from '../pages/Method.jsx'
import Scenario from '../pages/Scenario.jsx'
import HistoryDrawer from './HistoryDrawer.jsx'
import { usePracticeStore } from '../store/practiceStore.js'
import useAreaSwipe from './useAreaSwipe.js'
import { applyLightTemperature } from '../core/ui/lightTemperature.js'

const areas = [
  { id: 'ask', label: '问答', Component: Ask },
  { id: 'practice', label: '练习', Component: Practice },
  { id: 'trail', label: '足迹', Component: Trail },
]

function MainShell() {
  const activeArea = useAppStore((state) => state.activeArea)
  const drawerOpen = useAppStore((state) => state.drawerOpen)
  const setActiveArea = useAppStore((state) => state.setActiveArea)
  const setDrawerOpen = useAppStore((state) => state.setDrawerOpen)
  const newConversation = useAppStore((state) => state.newConversation)
  const openMethod = useAppStore((state) => state.openMethod)
  const openScenario = useAppStore((state) => state.openScenario)
  const practiceScreen = usePracticeStore((state) => state.screen)
  const focusedPractice = activeArea === 'practice' && practiceScreen === 'run'
  const mainRef = useRef(null)
  const viewportRef = useRef(null)
  const trackRef = useRef(null)
  const drawerRef = useRef(null)
  const activeIndex = areas.findIndex((area) => area.id === activeArea)
  useAreaSwipe({ viewportRef, trackRef, drawerRef, index: activeIndex, count: areas.length, disabled: drawerOpen,
    onChange: (index) => setActiveArea(areas[index].id), onDrawer: () => setDrawerOpen(true) })

  useEffect(() => {
    mainRef.current.inert = drawerOpen
    return () => { if (mainRef.current) mainRef.current.inert = false }
  }, [drawerOpen])

  function handleTabKey(event, index) {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!offset && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? areas.length - 1
      : (index + offset + areas.length) % areas.length
    setActiveArea(areas[next].id)
    document.getElementById(`tab-${areas[next].id}`)?.focus()
  }

  return (
    <div className="app-shell">
      <div ref={mainRef} className="main-frame flex min-h-0 flex-1 flex-col" aria-hidden={drawerOpen || undefined}>
        {!focusedPractice && <header className="top-bar">
          <button className="icon-button" aria-label="历史与设置" aria-expanded={drawerOpen} aria-controls="history-drawer" onClick={() => setDrawerOpen(true)}>
            <Menu size={21} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <nav className="area-tabs" role="tablist" aria-label="主要区域" style={{ '--active-area': activeIndex }}>
            <span className="area-tab-indicator" aria-hidden="true" />
            {areas.map((area, index) => (
              <button key={area.id} id={`tab-${area.id}`} className={`area-tab${activeArea === area.id ? ' is-active' : ''}`}
                role="tab" aria-selected={activeArea === area.id} aria-controls="area-panel"
                tabIndex={activeArea === area.id ? 0 : -1}
                onClick={() => setActiveArea(area.id)} onKeyDown={(event) => handleTabKey(event, index)}>
                {area.label}
              </button>
            ))}
          </nav>
          <button className="icon-button" aria-label="新对话" onClick={newConversation}>
            <Plus size={21} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </header>}
        <main ref={viewportRef} id="area-panel" role="tabpanel" aria-labelledby={focusedPractice ? 'practice-active-title' : `tab-${activeArea}`} className="area-panel area-swipe-viewport flex min-h-0 flex-1 flex-col">
          <div ref={trackRef} className="area-swipe-track">
            {areas.map(({ id, Component }) => <section key={id} className="area-swipe-page" data-area={id} aria-hidden={id !== activeArea || undefined}
              ref={(node) => { if (node) node.inert = id !== activeArea }}>
              <Component active={id === activeArea} onMethod={id === 'trail' ? openMethod : undefined} onScenario={id === 'trail' ? openScenario : undefined} />
            </section>)}
          </div>
        </main>
      </div>
      <HistoryDrawer layerRef={drawerRef} />
    </div>
  )
}

export default function App() {
  const theme = useAppStore((state) => state.preferences.theme)
  const lightTemperature = useAppStore((state) => state.preferences.lightTemperature)
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { applyLightTemperature(lightTemperature) }, [lightTemperature])
  const route = useAppStore((state) => state.route)
  const scenarioRef = useAppStore((state) => state.scenarioRef)
  const methodId = useAppStore((state) => state.methodId)
  const knowledgeBack = useAppStore((state) => state.knowledgeBack)
  const openMethod = useAppStore((state) => state.openMethod)
  const openScenario = useAppStore((state) => state.openScenario)
  const closeScenario = useAppStore((state) => state.closeScenario)
  const storageStatus = useAppStore((state) => state.storageStatus)
  const storageError = useAppStore((state) => state.storageError)
  const storageInitialized = useAppStore((state) => state.storageInitialized)
  const retryStorage = useAppStore((state) => state.retryStorage)
  const openSettings = useAppStore((state) => state.openSettings)
  const reading = !storageInitialized && storageStatus === 'loading'
  const failed = !storageInitialized && storageStatus === 'error'
  const methodBehindScenario = route === 'scenario' && knowledgeBack.at(-1)?.route === 'method'
  return (
    <div className="app-canvas">
      {(route === 'method' || methodBehindScenario) && <div key={methodId} style={{ display: route === 'method' ? 'contents' : 'none' }} aria-hidden={route !== 'method' || undefined}>
        <Method onScenario={openScenario} />
      </div>}
      {route === 'method' ? null : route === 'scenario' ? <Scenario nodeRef={scenarioRef} onBack={closeScenario} onMethod={openMethod} /> : route === 'settings' ? <Settings /> : reading ? (
        <main className="storage-page"><p className="muted" role="status">正在读取本地数据…</p></main>
      ) : failed ? (
        <main className="storage-page">
          <p role="status">{storageError || '本地数据暂时打不开。'}</p>
          <div className="storage-actions">
            <button type="button" className="button button-secondary" onClick={() => Promise.resolve(retryStorage()).catch(() => {})}>重试</button>
            <button type="button" className="button button-secondary" onClick={openSettings}>设置与数据恢复</button>
          </div>
        </main>
      ) : route === 'onboarding' ? <Onboarding /> : <MainShell />}
    </div>
  )
}
