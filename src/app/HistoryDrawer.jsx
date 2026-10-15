import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, Search, X } from 'lucide-react'
import { useAppStore } from '../store/appStore.js'
import MessageMenu from '../components/MessageMenu.jsx'
import ModalFrame from '../components/ModalFrame.jsx'

function HistoryThumbnail({ conversation, enabled }) {
  const ref = useRef(null)
  const currentImage = conversation.messages?.find((message) => message.image)?.image
  const imageId = currentImage?.id || conversation.firstImageId
  const [source, setSource] = useState(null)
  useEffect(() => {
    if (!enabled || !imageId || currentImage?.dataUrl || source?.id === imageId) return
    let alive = true
    let started = false
    async function read() {
      if (started) return
      started = true
      try {
        const { loadImage } = await import('../core/db/database.js')
        const image = await loadImage(imageId)
        if (alive) setSource({ id: imageId, dataUrl: image?.dataUrl })
      } catch { /* A thumbnail failure leaves its quiet document placeholder. */ }
    }
    if (!globalThis.IntersectionObserver) read()
    else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); read() }
      }, { root: ref.current?.closest('.history-list') })
      observer.observe(ref.current)
      return () => { alive = false; observer.disconnect() }
    }
    return () => { alive = false }
  }, [enabled, imageId, currentImage?.dataUrl, source?.id])
  const dataUrl = currentImage?.dataUrl || (source && source.id === imageId ? source.dataUrl : null)
  return <span ref={ref} className="history-thumbnail">{dataUrl
    ? <img src={dataUrl} alt="" />
    : <FileText size={16} strokeWidth={1.4} aria-hidden="true" />}</span>
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function groupHistory(conversations) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const groups = new Map()
  const sorted = conversations.filter((conversation) => (conversation.loaded === false ? conversation.messageCount : conversation.messages?.length) > 0)
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

export default function HistoryDrawer({ layerRef }) {
  const open = useAppStore((state) => state.drawerOpen)
  const conversations = useAppStore((state) => state.conversations)
  const currentId = useAppStore((state) => state.currentConversationId)
  const setDrawerOpen = useAppStore((state) => state.setDrawerOpen)
  const newConversation = useAppStore((state) => state.newConversation)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const openSettings = useAppStore((state) => state.openSettings)
  const drawerRef = useRef(null)
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
  const initialized = useAppStore((state) => state.storageInitialized)
  const needle = query.trim().toLocaleLowerCase()
  const snippets = new Map(matches.map((item) => [item.id, item.snippet]))
  const groups = groupHistory(needle ? conversations.filter((item) => snippets.has(item.id)
    || item.title.toLocaleLowerCase().includes(needle)
    || item.messages?.some((message) => message.content?.toLocaleLowerCase().includes(needle))) : conversations)

  useEffect(() => {
    if (!open || !needle) { setMatches([]); setSearching(false); setSearchError(''); return }
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
  }, [open, needle, initialized, conversations])

  useEffect(() => { drawerRef.current.inert = !open }, [open])
  useEffect(() => { if (!open) { setMenu(null); setDialog(null) } }, [open])
  useEffect(() => () => clearTimeout(pressRef.current?.timer), [])

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

  function navigate(action) {
    restoreFocusRef.current = false
    action()
  }

  function clearPress() { clearTimeout(pressRef.current?.timer); pressRef.current = null }
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
      else await useAppStore.getState().deleteConversation(dialog.conversation.id, includeLearning)
      setDialog(null)
    } catch (failure) { setError(failure.userMessage || '操作未完成，请重试。') }
    finally { setWorking(false) }
  }

  return (
    <><div ref={layerRef} className={`drawer-layer${open ? ' is-open' : ''}`}>
      <div className="drawer-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      <aside ref={drawerRef} id="history-drawer" className="history-drawer" role="dialog" aria-modal={open || undefined}
        aria-label="会话历史与设置" aria-hidden={!open}>
        <div className="drawer-header">
          <button className="drawer-new" onClick={() => navigate(newConversation)}><Plus size={18} strokeWidth={1.6} aria-hidden="true" />新对话</button>
          <button className="icon-button" aria-label="关闭抽屉" onClick={() => setDrawerOpen(false)}><X size={18} strokeWidth={1.6} aria-hidden="true" /></button>
        </div>
        <div className="history-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索历史会话" type="search" placeholder="搜索标题和聊天内容" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} />
          {query && <button className="icon-button" type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}
        </div>
        <div className="history-list">
          {needle && (searching || searchError) && <p className="history-empty muted" role="status">{searchError || '正在搜索…'}</p>}
          {groups.length === 0 && !searching && <p className="history-empty muted">{needle ? '没有找到相关会话。' : '还没有会话。'}</p>}
          {groups.map((group) => (
            <section key={group.key} className="history-group" aria-label={group.label}>
              <h2 className="history-date">{group.label}</h2>
              {group.conversations.map((conversation) => (
                <button key={conversation.id} className={`history-item${currentId === conversation.id ? ' is-selected' : ''}`}
                  aria-current={currentId === conversation.id ? 'true' : undefined}
                  title={conversation.title} onClick={() => { if (suppressRef.current) { suppressRef.current = false; return } navigate(() => selectConversation(conversation.id)) }}
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
                  <HistoryThumbnail conversation={conversation} enabled={open} />
                  <span className="history-copy"><span className="history-title">{conversation.title}</span>
                    {needle && snippets.get(conversation.id) && <span className="history-match">{snippets.get(conversation.id).replace(/\s+/g,' ')}</span>}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
        <button className="drawer-settings" onClick={() => navigate(openSettings)}>设置</button>
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
        : <><p>删除「{dialog?.conversation.title}」？</p><label className="history-delete-choice"><input type="checkbox" checked={includeLearning} disabled={working} onChange={(event) => setIncludeLearning(event.target.checked)} />同时删除这段对话产生的学习记录</label><p className="field-hint">{includeLearning ? '移除该对话的足迹；其它对话和练习取得的掌握度会保留。' : '只删除聊天，保留足迹、题面摘要和掌握度。'}</p></>}
      {error && <p className="field-hint" role="status">{error}</p>}
      <div className="dialog-actions"><button className="button button-secondary" disabled={working} onClick={() => setDialog(null)}>取消</button><button className="button button-primary" disabled={working || (dialog?.kind === 'rename' && !title.trim())} onClick={confirm}>{working ? '正在保存…' : dialog?.kind === 'rename' ? '保存' : '删除'}</button></div>
    </ModalFrame></>
  )
}
