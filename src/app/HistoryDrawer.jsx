import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileText, Plus, Search, X } from 'lucide-react'
import { useAppStore } from '../store/appStore.js'
import MessageMenu from '../components/MessageMenu.jsx'
import ModalFrame from '../components/ModalFrame.jsx'
import { bindHistorySwipe } from '../core/ui/historySwipe.js'
import { useWideLayout } from '../core/ui/layout.js'
import { createHistorySelector } from '../core/chat/historySummary.js'

// D3：历史抽屉不再渲染图片缩略图。原来的 HistoryThumbnail 要按需
// loadImage → base64 解码，并在每次列表渲染时扫描该会话全部消息找首图；
// 现在一律显示文档图标：省下图片解码、主线程开销与图片读取请求，
// 显示与排序行为不变（first_image_id 字段仍在，只是不再用于 UI）。
function HistoryIcon() {
  return <span className="history-thumbnail"><FileText size={16} strokeWidth={1.4} aria-hidden="true" /></span>
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function groupHistory(conversations) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const groups = new Map()
  // 内存态的方法讨论不进历史；只有用户点过“存进历史”的才留在这里。
  const sorted = conversations.filter((conversation) => !conversation.ephemeral && (conversation.loaded === false ? conversation.messageCount : conversation.messages?.length) > 0)
    .slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  for (const conversation of sorted) {
    const date = new Date(conversation.updatedAt)
    const key = conversation.pinned ? 'pinned' : dateKey(date)
    if (!groups.has(key)) {
      const label = key === 'pinned' ? '置顶' : key === dateKey(today) ? '今天' : key === dateKey(yesterday) ? '昨天'
        : new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(date)
      groups.set(key, { key, label, conversations: [] })
    }
    groups.get(key).conversations.push(conversation)
  }
  return [...groups.values()].sort((a,b) => Number(b.key === 'pinned') - Number(a.key === 'pinned'))
}

export default function HistoryDrawer({ layerRef, onProgress, onCloseThenSwitch, onSettings }) {
  const open = useAppStore((state) => state.drawerOpen)
  // 宽屏时抽屉是常驻左侧栏（CSS 里 ≥1100px 进文档流）。此时它虽然不在"打开"状态，
  // 但列表必须渲染、不能 inert、搜索要能用 —— 这些判断统一走 docked。
  const docked = useWideLayout()
  const visible = open || docked
  const historySelector = useMemo(createHistorySelector, [])
  const conversations = useAppStore(historySelector)
  const currentId = useAppStore((state) => state.currentConversationId)
  const setDrawerOpen = useAppStore((state) => state.setDrawerOpen)
  const newConversation = useAppStore((state) => state.newConversation)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const openSettings = useAppStore((state) => state.openSettings)
  const drawerRef = useRef(null)
  const listRef = useRef(null)
  // 本次打开是否已经复位过滚动位置：同一次打开内只复位一次，不打断用户自己的滚动。
  const resetScrollRef = useRef(false)
  const restoreFocusRef = useRef(true)
  const pressRef = useRef(null)
  const suppressRef = useRef(false)
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [title, setTitle] = useState('')
  const [includeLearning, setIncludeLearning] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  // P7：列表首次打开后保持挂载（.drawer-layer 关闭时本就是 visibility:hidden），
  // listReady 只在第一次打开时由一帧后的 rAF 置真，用来把首屏插入推迟到抽屉开始滑出之后。
  const [listReady, setListReady] = useState(false)
  const swipeEnabled = useRef(false)
  swipeEnabled.current = open && !menu && !dialog
  const initialized = useAppStore((state) => state.storageInitialized)
  const needle = query.trim().toLocaleLowerCase()
  // E4：匹配由数据库侧完成（覆盖未加载消息与附件正文），这里只保留展示所需的
  // id→摘要映射。渲染期不再逐条扫描消息正文——原来每个流式 delta 都要扫全库。
  const snippets = useMemo(() => new Map(matches.map((item) => [item.id, item.snippet])), [matches])
  // D12 / P7：分组结果按依赖缓存。抽屉关闭时不再做全量过滤与排序，而是直接复用上次结果
  // （列表现在关闭时也挂载，不能靠卸载来省这一步）；open 变化会重算，重新打开拿到的仍是最新数据。
  const groupsCache = useRef([])
  const groups = useMemo(() => {
    if (!visible) return groupsCache.current
    const next = groupHistory(needle
      ? conversations.filter((item) => snippets.has(item.id) || item.title.toLocaleLowerCase().includes(needle))
      : conversations)
    groupsCache.current = next
    return next
  }, [visible, needle, conversations, snippets])

  useEffect(() => {
    if (!visible || !needle) { setMatches([]); setSearching(false); setSearchError(''); return }
    let alive = true
    setSearching(true); setSearchError(''); setMatches([])
    const timer = setTimeout(async () => {
      try {
        const results = initialized ? await (await import('../core/db/database.js')).searchConversations(needle) : []
        if (alive) setMatches(results)
      } catch { if (alive) setSearchError('搜索暂时没能完成，请重试。') }
      finally { if (alive) setSearching(false) }
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
    // E4：不再把 conversations 列进依赖——流式期间每个 delta 都会重跑防抖并向
    // Worker 重发一次全表搜索。真正的触发条件是搜索词、开关与存储就绪状态。
  }, [visible, needle, initialized])

  // 常驻侧栏时不能 inert，否则整个历史栏点不动。
  useEffect(() => { drawerRef.current.inert = !visible }, [visible])
  useEffect(() => { if (!open) { setMenu(null); setDialog(null) } }, [open])
  useEffect(() => () => { clearTimeout(pressRef.current?.timer) }, [])
  useEffect(() => bindHistorySwipe(layerRef.current, {
    enabled: () => swipeEnabled.current,
    onClose: () => setDrawerOpen(false),
    onGesture: () => { clearPress(); suppressRef.current = true },
    // 已打开时横向拖拽关闭：实时把进度交回 onProgress（P2 起写的是三个元素的内联样式，
    // 不再写 --p），卡片与抽屉一起跟随手指，松手再落定
    onProgress,
  }), [layerRef, setDrawerOpen, onProgress])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = true
    const previous = document.activeElement
    const drawer = drawerRef.current
    drawer.querySelector('button')?.focus()
    function handleKeyDown(event) {
      if (event.target.closest?.('.message-menu-layer, .dialog-layer')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerOpen(false)
      }
      if (event.key !== 'Tab') return
      const buttons = [...drawer.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (restoreFocusRef.current && previous?.isConnected) requestAnimationFrame(() => previous.focus())
    }
  }, [open, setDrawerOpen])

  // P7：首次打开时把列表内容推迟一帧再插入 DOM —— 先把这一帧让给抽屉开始滑出，
  // 之后（含关闭后重开）listReady 永远为真，不再有这一步。
  // 宽屏常驻侧栏没有"滑出"这一步，同样需要渲染列表，所以判断条件是 visible。
  useEffect(() => {
    if (!visible || listReady) return
    const frame = requestAnimationFrame(() => setListReady(true))
    return () => cancelAnimationFrame(frame)
  }, [visible, listReady])

  // P7 副作用修正：列表常驻之后 scrollTop 不再随卸载归零，这里恢复"每次打开都从顶部开始"。
  // 依赖 open 与 listReady：首次打开要等 listReady 变真（内容插入、有了高度）那一帧才复位，
  // 否则复位打在空列表上等于没做；之后的每次打开内容本就挂载，open 一变就在布局阶段复位
  // （不会先闪一下中间位置）。关闭时只清标记，不动 scrollTop。
  useLayoutEffect(() => {
    if (!visible) { resetScrollRef.current = false; return }
    if (!listReady || resetScrollRef.current) return
    resetScrollRef.current = true
    if (listRef.current) listRef.current.scrollTop = 0
  }, [visible, listReady])

  const seenRowsRef = useRef(null)
  const rowSignature = JSON.stringify(groups.flatMap(group => group.conversations.map(item => item.id)))
  // 新出现的条目做一个入场：高度 + 透明度。抽屉关着直接返回——流式期间
  // conversations 每个 delta 都在变，这里不能变成逐帧的 DOM 查询。
  useLayoutEffect(() => {
    if (!visible) return
    const rows = [...(drawerRef.current?.querySelectorAll('.history-item') ?? [])]
    const ids = new Set(rows.map((row) => row.dataset.conversationId))
    if (!seenRowsRef.current) { seenRowsRef.current = ids; return }
    for (const row of rows) {
      if (seenRowsRef.current.has(row.dataset.conversationId)) continue
      const height = row.getBoundingClientRect().height
      if (!height) continue
      row.style.overflow = 'hidden'
      const animation = row.animate([{ height: '0px', opacity: 0 }, { height: height + 'px', opacity: 1 }],
        { duration: 200, easing: 'cubic-bezier(0.22,0.61,0.36,1)', fill: 'both' })
      animation.finished.catch(() => {}).then(() => { animation.cancel(); row.style.overflow = '' })
    }
    seenRowsRef.current = ids
  }, [visible, rowSignature, listReady])

  function navigate(action) {
    restoreFocusRef.current = false
    action()
  }

  function clearPress() { clearTimeout(pressRef.current?.timer); pressRef.current = null }
  function animateRowOut(id) {
    const row = drawerRef.current?.querySelector('.history-item[data-conversation-id="' + id + '"]')
    if (!row) return Promise.resolve()
    const height = row.getBoundingClientRect().height
    const previous = row.style.overflow
    row.style.overflow = 'hidden'
    const animation = row.animate([{ height: height + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: 180, easing: 'cubic-bezier(0.22,0.61,0.36,1)', fill: 'both' })
    return animation.finished.catch(() => {}).then(() => { animation.cancel(); row.style.overflow = previous })
  }
  function openMenu(event, conversation) {
    event.preventDefault()
    clearPress()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ conversation, trigger: event.currentTarget, anchor: { x: event.clientX || rect.left + 20, y: event.clientY || rect.top + 20 } })
  }
  function openDialog(kind, conversation) {
    setTitle(conversation.title); setIncludeLearning(false); setError(''); setDialog({ kind, conversation })
  }
  async function confirm() {
    if (working || !dialog) return
    setWorking(true); setError('')
    try {
      if (dialog.kind === 'rename') await useAppStore.getState().updateConversation(dialog.conversation.id, { title })
      else {
        // 先把这一条收起来（高度 + 透明度，180ms），动画结束再真正删除：
        // 否则下面的条目会“跳”上来，那一下比别处的闪现更刺眼。
        await animateRowOut(dialog.conversation.id)
        await useAppStore.getState().deleteConversation(dialog.conversation.id, includeLearning)
      }
      setDialog(null)
    } catch (failure) { setError(failure.userMessage || '操作未完成，请重试。') }
    finally { setWorking(false) }
  }

  return (
    <><div ref={layerRef} className={`drawer-layer${open ? ' is-open' : ''}`}>
      <div className="drawer-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      <aside ref={drawerRef} id="history-drawer" className="history-drawer" role="dialog" aria-modal={open || undefined}
        aria-label="会话历史与设置" aria-hidden={!visible || undefined}>
        <div className="drawer-header">
          <button className="drawer-new" onClick={() => navigate(newConversation)}><Plus size={18} strokeWidth={1.6} aria-hidden="true" />新对话</button>
          <button className="icon-button" aria-label="关闭抽屉" onClick={() => setDrawerOpen(false)}><X size={18} strokeWidth={1.6} aria-hidden="true" /></button>
        </div>
        <div className="history-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索历史会话" type="search" placeholder="搜索标题和聊天内容" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} />
          {query && <button className="icon-button" type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}
        </div>
        <div className="history-list" ref={listRef}>
          {listReady && <>
          {needle && (searching || searchError) && <p className="history-empty muted" role="status">{searchError || '正在搜索…'}</p>}
          {groups.length === 0 && !searching && <p className="history-empty muted">{needle ? '没有找到相关会话。' : '还没有会话。'}</p>}
          {groups.map((group) => (
            <section key={group.key} className="history-group" aria-label={group.label}>
              <h2 className="history-date">{group.label}</h2>
              {group.conversations.map((conversation) => (
                <button key={conversation.id} data-conversation-id={conversation.id} className={`history-item${currentId === conversation.id ? ' is-selected' : ''}`}
                  aria-current={currentId === conversation.id ? 'true' : undefined}
                  title={conversation.title} onClick={() => {
                    if (suppressRef.current) { suppressRef.current = false; return }
                    // 换会话必须等抽屉收拢动画真正落定，不能再用固定 220ms 猜时间：
                    // 猜早了会和收尾那一帧撞车（越长的对话越明显），猜晚了又显得拖沓。
                    // 现在由父组件在动画 finished 之后回调，并用 startTransition 做可中断重渲染。
                    const select = () => navigate(() => selectConversation(conversation.id))
                    if (!open) { select(); return }
                    if (onCloseThenSwitch) onCloseThenSwitch(select)
                    else { setDrawerOpen(false); select() }
                  }}
                  onContextMenu={(event) => openMenu(event, conversation)}
                  onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, conversation) }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    clearPress(); suppressRef.current = false
                    const trigger = event.currentTarget, anchor = { x: event.clientX, y: event.clientY }
                    pressRef.current = { ...anchor, timer: setTimeout(() => { suppressRef.current = true; setMenu({ conversation, trigger, anchor }) }, 500) }
                  }}
                  onPointerMove={(event) => { if (pressRef.current && (Math.abs(event.clientX - pressRef.current.x) > 10 || Math.abs(event.clientY - pressRef.current.y) > 10)) clearPress() }}
                  onPointerUp={clearPress} onPointerCancel={clearPress}>
                  <HistoryIcon />
                  <span className="history-copy">
                    <span className="history-title-row"><span className="history-title">{conversation.title}</span>
                      {conversation.methodId && <span className="history-mark">讨论</span>}</span>
                    {needle && snippets.get(conversation.id) && <span className="history-match">{snippets.get(conversation.id).replace(/\s+/g,' ')}</span>}
                  </span>
                </button>
              ))}
            </section>
          ))}
          </>}
        </div>
        <button className="drawer-settings" onClick={() => navigate(onSettings || openSettings)}>设置</button>
      </aside>
    </div>
    {menu && <MessageMenu {...menu} onClose={() => setMenu(null)} items={[
      { label: menu.conversation.pinned ? '取消置顶' : '置顶', onSelect: () => { useAppStore.getState().updateConversation(menu.conversation.id, { pinned: !menu.conversation.pinned }).catch(() => {}) } },
      { label: '重命名', onSelect: () => openDialog('rename', menu.conversation) },
      { label: '删除', onSelect: () => openDialog('delete', menu.conversation) },
    ]} />}
    <ModalFrame open={Boolean(dialog)} titleId="history-operation-title" className="confirm-dialog" onClose={() => { if (!working) setDialog(null) }}>
      <h2 id="history-operation-title">{dialog?.kind === 'rename' ? '重命名对话' : '删除对话'}</h2>
      {dialog?.kind === 'rename' ? <input className="field-control" aria-label="对话名称" value={title} maxLength={80} disabled={working} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && title.trim()) confirm() }} />
        : <><p>删除「{dialog?.conversation.title}」？</p><label className="history-delete-choice"><input type="checkbox" checked={includeLearning} disabled={working} onChange={(event) => setIncludeLearning(event.target.checked)} />同时删除这段对话产生的学习记录</label><p className="field-hint">{includeLearning ? '同时删除足迹，其它对话的掌握度保留。' : '保留足迹、题面摘要和掌握度。'}</p></>}
      {error && <p className="field-hint" role="status">{error}</p>}
      <div className="dialog-actions"><button className="button button-secondary" disabled={working} onClick={() => setDialog(null)}>取消</button><button className="button button-primary" disabled={working || (dialog?.kind === 'rename' && !title.trim())} onClick={confirm}>{working ? '正在保存…' : dialog?.kind === 'rename' ? '保存' : '删除'}</button></div>
    </ModalFrame></>
  )
}
