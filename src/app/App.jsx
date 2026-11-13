import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import AppTour, { tourDone, resetTour } from '../components/AppTour.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { usePracticeStore } from '../store/practiceStore.js'
import useAreaSwipe from './useAreaSwipe.js'
import { applyLightTemperature } from '../core/ui/lightTemperature.js'
import { useWideLayout } from '../core/ui/layout.js'

const areas = [
  { id: 'ask', label: '问答', Component: Ask },
  { id: 'practice', label: '练习', Component: Practice },
  { id: 'trail', label: '足迹', Component: Trail },
]
// 抽屉落定动画时长（毫秒）：与 CSS 里各处 180ms 的手感保持一致。
const DRAWER_SETTLE_MS = 180
// 与旧 CSS 过渡的 ease-out 对齐：换实现不改手感。
const DRAWER_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

// 把进度直接写进三个元素的内联样式。手指拖拽期间逐帧调用（必须跟手）；
// 点击开合时改由 Web Animations 补间，结束后再落到这里。
function writeDrawerProgress(els, p) {
  els.card.style.transform = `scale(${1 - els.scale * p})`
  els.scrim.style.opacity = String(p)
  els.drawer.style.transform = `translateX(${(p - 1) * 100}%)`
}

function MainShell({ onSettings }) {
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
  // 顶部区域线：一条线在三个标签之间滑动，视觉与设置页「外观」那条线完全一致 ——
  // 量真实文字墨迹、440ms、cubic-bezier(0.34,0.9,0.4,1)、滑到中点宽度收到 0.5 再展开。
  // 定位写 transform+width（与 left+width 的位移数学等价，但从元素自身盒起算，
  // 不被包含块的内边距/边框带偏）；手指拖区页时线按同一进度连续跟手。
  const tabsRef = useRef(null), tabIndicatorRef = useRef(null)
  const tabAnimTimer = useRef(null)
  const dragRef = useRef({ skipSquash: false, dragging: false })
  const activeIndexRef = useRef(activeIndex)
  // 下标写进 ref：收尾回调可能在一次被丢弃的渲染之后才跑，闭包里直接抓 activeIndex
  // 会抓到旧下标，线就"自己跑回上一个标签"。
  useLayoutEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])
  const tabInk = useCallback((index) => {
    const nav = tabsRef.current
    const button = nav?.querySelectorAll('.area-tab')[index]
    if (!button) return null
    const range = document.createRange()
    range.selectNodeContents(button)
    const ink = range.getBoundingClientRect()
    const box = nav.getBoundingClientRect()
    if (!ink.width) return null
    return { left: ink.left - box.left - nav.clientLeft, width: ink.width, top: ink.bottom - box.top - nav.clientTop + 3 }
  }, [])
  const placeTabLine = useCallback((target) => {
    const line = tabIndicatorRef.current
    if (!line || !target) return
    line.style.width = target.width + 'px'
    line.style.transform = 'translate(' + target.left + 'px,' + target.top + 'px)'
  }, [])
  // 收尾一律用定时器，不依赖 WAAPI 的 finished promise：窗口被遮挡或合成线程不推进时
  // 那个 promise 可能一直不 resolve，线就卡在"动画没结束"的状态，后面任何一次复量都被挡住，
  // 直到某次错误的落位把它按旧下标写回去。
  const settleTabLine = useCallback(() => {
    clearTimeout(tabAnimTimer.current); tabAnimTimer.current = null
    const line = tabIndicatorRef.current
    if (!line) return
    line.getAnimations().forEach((animation) => animation.cancel())
    placeTabLine(tabInk(activeIndexRef.current))
  }, [placeTabLine, tabInk])
  const animateTabLine = useCallback((target) => {
    const nav = tabsRef.current, line = tabIndicatorRef.current
    if (!nav || !line || !target) return
    clearTimeout(tabAnimTimer.current); tabAnimTimer.current = null
    const box = nav.getBoundingClientRect()
    const current = line.getBoundingClientRect()
    // 起点读"实际矩形"而不是记下的终点：连续快速切换时上一条动画会被取消，
    // 用记下的值起跳会从错的位置走（设置页那条线也是这么处理的）。
    const from = current.width > 0 ? { left: current.left - box.left - nav.clientLeft, width: current.width } : null
    line.getAnimations().forEach((animation) => animation.cancel())
    if (!from || prefersReducedMotion?.()) { placeTabLine(target); return }
    const at = (x, width) => ({ width: width + 'px', transform: 'translate(' + x + 'px,' + target.top + 'px)' })
    const centreMid = (from.left + from.width / 2 + target.left + target.width / 2) / 2
    const widthMid = ((from.width + target.width) / 2) * 0.5
    line.animate([
      at(from.left, from.width),
      { ...at(centreMid - widthMid / 2, widthMid), offset: 0.5 },
      at(target.left, target.width),
    ], { duration: 440, easing: 'cubic-bezier(0.34,0.9,0.4,1)', fill: 'both' })
    tabAnimTimer.current = setTimeout(settleTabLine, 460)
  }, [placeTabLine, settleTabLine])
  useLayoutEffect(() => {
    if (!tabsRef.current || !tabIndicatorRef.current) return
    // 手指已经把线拖到目标附近了：直接落位，不再补一段"压扁"（那会看成一记抖动）。
    if (dragRef.current.skipSquash) { dragRef.current.skipSquash = false; placeTabLine(tabInk(activeIndex)); return }
    animateTabLine(tabInk(activeIndex))
  }, [activeIndex, animateTabLine, placeTabLine, tabInk])
  // 手指滑动区页时线跟着走：progress 是连续下标（1.37 = 从第 1 个往第 2 个走了 37%）。
  // 位置按进度插值，宽度按同一条正弦收到一半 —— 与补间动画中点那一帧严格一致。
  const dragTabLine = useCallback((progress) => {
    const line = tabIndicatorRef.current
    if (!line) return
    const p = Math.min(areas.length - 1, Math.max(0, progress))
    const base = Math.floor(p), a = tabInk(base), b = tabInk(Math.min(areas.length - 1, base + 1))
    if (!a || !b) return
    const t = p - base
    const centre = a.left + a.width / 2 + (b.left + b.width / 2 - a.left - a.width / 2) * t
    const width = (a.width + (b.width - a.width) * t) * (1 - 0.5 * Math.sin(Math.PI * t))
    clearTimeout(tabAnimTimer.current); tabAnimTimer.current = null
    dragRef.current.dragging = true
    line.getAnimations().forEach((animation) => animation.cancel())
    line.style.width = width + 'px'
    line.style.transform = 'translate(' + (centre - width / 2) + 'px,' + a.top + 'px)'
  }, [tabInk])
  const onAreaProgress = useCallback((progress, released) => {
    if (progress != null) { dragTabLine(progress); return }
    dragRef.current.dragging = false
    if (released == null) return
    // 松手没换区：让线按同一条曲线滑回原标签。换区则交给 activeIndex 的 layout effect，
    // 那里直接落位 —— 线已经被手指带过去了，再补一段压扁会看成抖动。
    if (released === activeIndex) animateTabLine(tabInk(released))
    else dragRef.current.skipSquash = true
  }, [activeIndex, animateTabLine, dragTabLine, tabInk])
  // 只量一次不够：安卓中文字体回退是异步的，粗细切换也会改变字宽。任何尺寸变化或
  // 字体就绪都重新落位；正在滑的时候等它收尾再量。
  useEffect(() => {
    const nav = tabsRef.current, line = tabIndicatorRef.current
    if (!nav || !line) return
    // 正在滑或手指正拖着的时候不量：那会把线从半路上拽走。
    const refit = () => { if (!tabAnimTimer.current && !dragRef.current.dragging) settleTabLine() }
    const observer = globalThis.ResizeObserver ? new ResizeObserver(refit) : null
    observer?.observe(nav)
    for (const button of nav.querySelectorAll('.area-tab')) observer?.observe(button)
    document.fonts?.ready.then(refit).catch(() => {})
    return () => { observer?.disconnect(); clearTimeout(tabAnimTimer.current) }
  }, [settleTabLine])

  const progressRef = useRef(0)
  const animationsRef = useRef([])
  const drawerElsRef = useRef(null)
  const afterSettleRef = useRef(null)
  const pendingSwitchRef = useRef(null)
  // 宽屏（≥1100px）抽屉是常驻侧栏，由 CSS 静态布局接管：不写内联 transform、
  // 不跑开合补间，否则会和 @media 里的 !important 打架。
  const docked = useWideLayout()
  const dockedRef = useRef(docked)
  dockedRef.current = docked
  // 抽屉开合不再逐帧写 --p（--p 挂在 .app-shell 上，一变整棵子树都要重算样式）。
  // 现在：手指拖拽逐帧写三个元素的内联样式（必须跟手）；点击开合用 Web Animations
  // 补间同样的三条属性，由合成器执行，不触发主线程样式重算；动画结束再一次性落到内联样式。
  // 相比旧的「临时类 + CSS 过渡 + transitionend + 超时兜底」：不再有类切换引发的整页重新
  // 光栅化（那一下正好落在动画首尾），也不存在过渡被打断时的收尾竞态。
  const stopDrawerAnimations = useCallback(() => {
    const running = animationsRef.current
    animationsRef.current = null
    for (const animation of running?.list ?? []) { try { animation.cancel() } catch { /* 已结束 */ } }
  }, [])

  const setDrawerProgress = useCallback((value, dragging = false) => {
    const card = mainRef.current
    const shell = card?.parentElement
    const layer = drawerRef.current
    const scrim = layer?.querySelector?.('.drawer-scrim')
    const drawer = layer?.querySelector?.('.history-drawer')
    if (!shell || !layer || !scrim || !drawer) return
    // 常驻侧栏模式：几何由 CSS 决定，这里只记录进度，不动任何元素。
    if (dockedRef.current) { progressRef.current = value; return }
    let els = drawerElsRef.current
    if (!els || els.shell !== shell || els.card !== card || els.scrim !== scrim || els.drawer !== drawer) {
      // --drawer-scale 只在元素集合建立时读一次：逐帧 getComputedStyle 会强制一次样式重算。
      const scale = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--drawer-scale')) || 0.05
      drawerElsRef.current = els = { shell, card, scrim, drawer, scale }
    }
    if (dragging) {
      shell.classList.add('is-drawer-dragging')
      shell.classList.remove('is-drawer-settled')
    }
    // 同一目标的补间正在跑就不要重来：拖拽松手时先 onProgress(目标) 起一段落定动画，
    // 紧接着 onClose() 让 drawerOpen 变化、React 的 effect 又用同一个目标调一次。
    // 旧写法会在这里把刚起步的动画 cancel 掉并直接写终值 —— 表现就是"手一松立刻闪到终点"。
    if (!dragging && animationsRef.current?.value === value) return
    const from = progressRef.current
    stopDrawerAnimations()
    if (dragging) {
      progressRef.current = value
      writeDrawerProgress(els, value)
      return
    }
    progressRef.current = value
    const settle = () => {
      // will-change 只在「拖拽 + 落定」这段挂着：常驻会养出一个不释放的合成层，
      // 而每次加/摘类都会让浏览器重新光栅化，所以统一压到落定这一刻。
      shell.classList.remove('is-drawer-dragging')
      // 毛玻璃只在「已落定且全开」时挂上：静止时背景不变，模糊只栅格化一次；
      // 一旦开始补间，卡片在缩放、背景每帧都变，模糊只能逐帧重算（实测 67ms vs 5ms）。
      shell.classList.toggle('is-drawer-settled', value >= 1)
      // 落定后才挂 inert（见上方注释）：动画帧里不再有整棵子树的交互重算。
      if (mainRef.current) mainRef.current.inert = value >= 1
      writeDrawerProgress(els, value)
      afterSettleRef.current?.(value)
    }
    if (Math.abs(value - from) < 0.001) { settle(); return }
    // 时长固定 180ms：抽屉是直接操作的手势件，旧实现（P2 的 rAF 补间）在
    // prefers-reduced-motion 下也照样补间，这里保持一致，避免"升级后动画消失"。
    // 真要不动的用户，系统级减少动态效果已经让 CSS 过渡全部关闭，这里只保留这一个手势反馈。
    const duration = DRAWER_SETTLE_MS
    const targets = [
      [els.card, { transform: `scale(${1 - els.scale * from})` }, { transform: `scale(${1 - els.scale * value})` }],
      [els.scrim, { opacity: String(from) }, { opacity: String(value) }],
      [els.drawer, { transform: `translateX(${(from - 1) * 100}%)` }, { transform: `translateX(${(value - 1) * 100}%)` }],
    ]
    const animations = targets.map(([element, start, end]) => element.animate([start, end],
      { duration, easing: DRAWER_EASING, fill: 'both' }))
    animationsRef.current = { list: animations, value }
    // 诊断钩子：只有 ?perf=1 时 __mathmythPerf 才存在，平时是 undefined 短路，零成本。
    globalThis.__mathmythPerf?.noteDrawer?.({ from, value, duration, count: animations.length, reducedMotion: prefersReducedMotion() })
    Promise.all(animations.map((animation) => animation.finished.catch(() => null))).then(() => {
      // 被下一轮开合接管时直接放弃收尾：新动画已经接管同一批属性。
      if (animationsRef.current?.list !== animations) return
      animationsRef.current = null
      for (const animation of animations) { try { animation.cancel() } catch { /* 已结束 */ } }
      settle()
    })
  }, [stopDrawerAnimations])

  // 只有关闭动画真正落定之后，才允许做「整屏内容替换」。
  // 换会话 = 整页重排 + 公式重新解析；和收拢动画最后一帧撞在一起，就是
  // "对话越长、越卡在边栏收回那一刻"的直接原因。这里用动画的 finished 精确对齐，
  // 再让出一帧、用 startTransition 把重渲染降为可中断优先级。
  useEffect(() => {
    afterSettleRef.current = (value) => {
      if (value > 0) return
      const pending = pendingSwitchRef.current
      pendingSwitchRef.current = null
      if (!pending) return
      requestAnimationFrame(() => startTransition(pending))
    }
  }, [])

  const closeDrawerThen = useCallback((action) => {
    pendingSwitchRef.current = action
    setDrawerOpen(false)
  }, [setDrawerOpen])

  useEffect(() => { if (drawerOpen) pendingSwitchRef.current = null }, [drawerOpen])
  // 视口变化（横竖屏切换、分屏、窗口缩放）时 --drawer-w / --drawer-scale 会变，
  // 缓存里的 scale 与内联位移必须按新尺寸重算，否则边界会差一截。
  useEffect(() => {
    const reflow = () => { drawerElsRef.current = null; setDrawerProgress(progressRef.current) }
    globalThis.addEventListener?.('resize', reflow)
    globalThis.addEventListener?.('orientationchange', reflow)
    return () => {
      globalThis.removeEventListener?.('resize', reflow)
      globalThis.removeEventListener?.('orientationchange', reflow)
    }
  }, [setDrawerProgress])
  useEffect(() => () => stopDrawerAnimations(), [stopDrawerAnimations])
  useEffect(() => { setDrawerProgress(drawerOpen ? 1 : 0) }, [drawerOpen, setDrawerProgress])
  useAreaSwipe({ viewportRef, trackRef, drawerRef, index: activeIndex, count: areas.length, disabled: drawerOpen,

    onChange: (index) => setActiveArea(areas[index].id), onDrawer: () => setDrawerOpen(true), onProgress: setDrawerProgress,
    onAreaProgress })

  // inert 已从「drawerOpen 变化时立刻执行」挪到 setDrawerProgress 的落定回调：
  // 切换 inert 要对整棵子树重算可聚焦性与无障碍树（实测 40 节点 1.8ms → 1200 节点 5.3ms，
  // 真实长会话可达几十毫秒），绝不能落在动画第一帧。动画期间由 aria-hidden（实测 ~0ms）
  // 和遮罩隔离，落定后再挂 inert。
  useEffect(() => () => { if (mainRef.current) mainRef.current.inert = false }, [])

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
      <div ref={mainRef} className="main-frame base-card flex min-h-0 flex-1 flex-col" aria-hidden={drawerOpen || undefined}>
        {!focusedPractice && <header className="top-bar">
          <button className="icon-button" aria-label="历史与设置" aria-expanded={drawerOpen} aria-controls="history-drawer" onClick={() => setDrawerOpen(true)}>
            <Menu size={21} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <nav className="area-tabs" role="tablist" aria-label="主要区域" style={{ '--active-area': activeIndex }} ref={tabsRef}>
            <span className="area-tab-indicator" aria-hidden="true" ref={tabIndicatorRef} />
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
              <ErrorBoundary scope={areas.find((area) => area.id === id)?.label} onRetry={() => setActiveArea(id)}>
                <Component active={id === activeArea} onMethod={id === 'trail' ? openMethod : undefined} onScenario={id === 'trail' ? openScenario : undefined} />
              </ErrorBoundary>
            </section>)}
          </div>
        </main>
      </div>
      <HistoryDrawer layerRef={drawerRef} onProgress={setDrawerProgress} onCloseThenSwitch={closeDrawerThen} onSettings={onSettings} />
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
  const exitError = useAppStore((state) => state.exitError)
  const storageInitialized = useAppStore((state) => state.storageInitialized)
  const retryStorage = useAppStore((state) => state.retryStorage)
  const openSettings = useAppStore((state) => state.openSettings)
  const closeSettings = useAppStore((state) => state.closeSettings)
  const onboarded = useAppStore((state) => state.onboarded)
  // 引导只在"首启一次"出现：跑完/跳过都写标记；设置页可以随时重看。
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => {
    if (route !== 'main' || !onboarded || !storageInitialized || tourDone()) return
    const timer = setTimeout(() => setTourOpen(true), 600)
    return () => clearTimeout(timer)
  }, [route, onboarded, storageInitialized])
  useEffect(() => {
    const replay = () => { resetTour(); setTourOpen(true) }
    window.addEventListener('mathmyth:tour', replay)
    return () => window.removeEventListener('mathmyth:tour', replay)
  }, [])
  // 从抽屉点“设置”：抽屉原地扩成整页。背景（卡片缩放 + 遮罩毛玻璃）全程冻结 ——
  // 用户不会再回到主界面，所以这一段没有任何东西需要复原，模糊只栅格化一次。
  // 填充层只做横向缩放（无 width、无布局）；设置页提前以 opacity:0 挂载，
  // 把首次布局（实测 31ms）挪到动画开始之前付掉。
  const [morphing, setMorphing] = useState(false)
  const settingsLayerRef = useRef(null)
  const startSettingsMorph = useCallback(() => setMorphing(true), [])
  useEffect(() => {
    if (!morphing) return
    const layer = document.querySelector('.drawer-layer')
    const drawer = layer?.querySelector?.('.history-drawer')
    const settingsLayer = settingsLayerRef.current
    const finish = () => { openSettings(); setMorphing(false) }
    if (prefersReducedMotion() || !layer || !drawer || !settingsLayer) { finish(); return }
    let cancelled = false
    let filler = null
    const animations = []
    const frame = requestAnimationFrame(() => {
      const layerRect = layer.getBoundingClientRect()
      const drawerRect = drawer.getBoundingClientRect()
      // 抽屉右缘的边线在扩张开始这一帧就交出去：边界已经归填充层的前缘，
      // 留着它就会一直压在新铺开的面板上，直到最后整块卸载才"啪"一下消失。
      drawer.style.borderRightColor = 'transparent'
      filler = document.createElement('div')
      filler.className = 'settings-morph-filler'
      filler.style.left = Math.max(0, drawerRect.right - layerRect.left) + 'px'
      layer.insertBefore(filler, drawer)
      for (const child of drawer.children) {
        animations.push(child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: 'ease-in', fill: 'both' }))
      }
      // 位移而不是缩放：scaleX 会把前缘那条 1px 细线一起拉细（0.35 倍时只剩 0.35px）。
      animations.push(filler.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }], { duration: 260, easing: DRAWER_EASING, fill: 'both' }))
      // 140ms 起淡入：抽屉内容 130ms 就走完，再晚就会空出一段什么都没有的屏幕。
      animations.push(settingsLayer.animate([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'translateX(0px)' }], { duration: 160, easing: 'ease-out', fill: 'both', delay: 140 }))
      Promise.all(animations.map((animation) => animation.finished.catch(() => null)))
        .then(() => { if (!cancelled) finish() })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      for (const animation of animations) { try { animation.cancel() } catch { /* 已结束 */ } }
      if (filler?.parentNode) filler.remove()
      if (drawer) drawer.style.borderRightColor = ''
    }
  }, [morphing, openSettings])
  // 返回：单拍。设置页淡出并向右让 24px，露出下面已经就位的主界面；动画结束才切路由，
  // 所以中间不会出现一帧空白。
  const [leaving, setLeaving] = useState(false)
  const requestCloseSettings = useCallback(() => {
    if (leaving) return
    const layer = settingsLayerRef.current
    if (!layer || prefersReducedMotion()) { closeSettings(); return }
    setLeaving(true)
    requestAnimationFrame(() => {
      const animation = layer.animate(
        [{ opacity: 1, transform: 'translateX(0px)' }, { opacity: 0, transform: 'translateX(24px)' }],
        { duration: 180, easing: DRAWER_EASING, fill: 'both' })
      animation.finished.catch(() => {}).then(() => {
        animation.cancel()
        layer.style.opacity = ''
        layer.style.transform = ''
        setLeaving(false)
        closeSettings()
      })
    })
  }, [closeSettings, leaving])
  // 首次进入主界面时把"这个应用怎么用"过一遍；看完/跳过都只记在本机偏好里。
  const reading = !storageInitialized && storageStatus === 'loading'
  const failed = !storageInitialized && storageStatus === 'error'
  const methodBehindScenario = route === 'scenario' && knowledgeBack.at(-1)?.route === 'method'
  return (
    <div className="app-canvas">
      {(route === 'method' || methodBehindScenario) && <div key={methodId} style={{ display: route === 'method' ? 'contents' : 'none' }} aria-hidden={route !== 'method' || undefined}>
        <Method onScenario={openScenario} />
      </div>}
      {route === 'method' ? null : route === 'scenario' ? <Scenario nodeRef={scenarioRef} onBack={closeScenario} onMethod={openMethod} /> : reading ? (
        <main className="storage-page"><p className="muted" role="status">正在读取本地数据…</p></main>
      ) : failed ? (
        <main className="storage-page">
          <p role="status">{storageError || '本地数据暂时打不开。'}</p>
          <div className="storage-actions">
            <button type="button" className="button button-secondary" onClick={() => Promise.resolve(retryStorage()).catch(() => {})}>重试</button>
            <button type="button" className="button button-secondary" onClick={openSettings}>设置与数据恢复</button>
          </div>
        </main>
      ) : route === 'onboarding' ? <ErrorBoundary scope="首次设置"><Onboarding /></ErrorBoundary> : (route === 'main' || leaving) ? <MainShell onSettings={startSettingsMorph} /> : null}
      {(route === 'settings' || morphing) && <div className="settings-layer" ref={settingsLayerRef} style={morphing ? { opacity: 0 } : undefined}><ErrorBoundary scope="设置"><Settings onClose={requestCloseSettings} /></ErrorBoundary></div>}
      {tourOpen && <AppTour onDone={() => setTourOpen(false)} />}
      {exitError && createPortal(<section className="confirm-dialog storage-close-error" role="alert">
        <p>{exitError}</p>
        <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => useAppStore.getState().prepareForExit().catch(() => {})}>重试保存</button></div>
      </section>, document.body)}
    </div>
  )
}
