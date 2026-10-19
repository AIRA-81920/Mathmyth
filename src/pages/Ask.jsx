import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, Plus, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Image as ImageIcon, Paperclip, Square, X, FileText } from 'lucide-react'
import { useAppStore } from '../store/appStore.js'
import MathMarkdown from '../components/MathMarkdown.jsx'
import MessageMenu from '../components/MessageMenu.jsx'
import ThinkingIndicator from '../components/ThinkingIndicator.jsx'
import ChatPracticeCard from '../components/ChatPracticeCard.jsx'
import AnimatedDisclosure from '../components/AnimatedDisclosure.jsx'
import QuestionRoutePanel from '../components/QuestionRoutePanel.jsx'
import ThinkingSwitch from '../components/ThinkingSwitch.jsx'
import useQuestionScroll from '../app/useQuestionScroll.js'
import { thinkingCapability } from '../core/ai/answerThinking.js'
import { loadSkeleton } from '../core/skeleton/load.js'
import { useChatPracticeStore } from '../store/chatPracticeStore.js'
import { visibleMessages, revisionVersions } from '../core/chat/revisions.js'
import { getMessageQuestionClassification, requestMessageQuestionClassification, setQuestionStar, onDatabaseChange, loadQuestionRoutes } from '../core/db/database.js'
import '../styles/message-actions.css'
import { readAttachment, FILE_ACCEPT } from '../core/files/input.js'
import { isNative, pickNativePhoto, photoToFile, onRestoredPhoto } from '../core/platform/photos.js'
import { hideInputKeyboard, recentNativePhotos } from '../core/platform/attachments.js'
import { matchesPendingPhoto, submissionAttachment } from '../core/images/crop.js'
import '../styles/image-crop.css'
const CameraCapture = lazy(() => import('../components/CameraCapture.jsx'))
const ImageCrop = lazy(() => import('../components/ImageCrop.jsx'))

export default function Ask({ active = true }) {
  const currentId = useAppStore((state) => state.currentConversationId)
  const conversation = useAppStore((state) => state.conversations.find((item) => item.id === state.currentConversationId))
  const supportsImage = useAppStore((state) => state.modelConfig.supportsImage)
  const modelConfig = useAppStore((state) => state.modelConfig)
  const thinkingMode = useAppStore((state) => state.preferences.answerThinking)
  const setAnswerThinking = useAppStore((state) => state.setAnswerThinking)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const stopGenerating = useAppStore((state) => state.stopGenerating)
  const selectMessageRevision = useAppStore((state) => state.selectMessageRevision)
  const reviseUserMessage = useAppStore((state) => state.reviseUserMessage)
  const conversationLoading = useAppStore((state) => state.conversationLoading)
  const dataOperation = useAppStore((state) => state.dataOperation)
  const storageError = useAppStore((state) => state.storageError)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState(null)
  const [editing, setEditing] = useState(null)
  const [answering, setAnswering] = useState(null)
  const practiceBusy = useChatPracticeStore((state) => Boolean(state.busy[answering?.id]))
  const [classifications, setClassifications] = useState({})
  const [questionRoutes, setQuestionRoutes] = useState({})
  const [skeleton, setSkeleton] = useState(null)
  const [starring, setStarring] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [crop, setCrop] = useState(null)
  const [recentPhotos, setRecentPhotos] = useState([])
  const [readProgress, setReadProgress] = useState('')
  const [readingImage, setReadingImage] = useState(false)
  const [inputError, setInputError] = useState('')
  const inputRef = useRef(null)
  const classificationEpoch = useRef(0)
  const flowRef = useRef(null)
  const contentRef = useRef(null)
  const galleryRef = useRef(null)
  const cameraRef = useRef(null)
  const fileRef = useRef(null)
  const imageTaskRef = useRef({ version: 0, controller: null })
  const longPressRef = useRef(null)
  const restoredHandler = useRef(null)
  const allMessages = conversation?.messages ?? []
  const messages = visibleMessages(allMessages)
  const editingMessage = editing && messages.find((message) => message.id === editing.id)
  const writing = editing || answering
  const composerText = writing ? writing.text : draft
  const canSubmit = editing ? Boolean(editingMessage && (editing.text.trim() || editingMessage.image || editingMessage.attachments?.length)) : answering ? Boolean(answering.text.trim()) : Boolean(draft.trim() || attachments.length)
  const busy = messages.some((message) => message.status === 'streaming') || practiceBusy
  const blocked = Boolean(conversationLoading || conversation?.loaded === false || dataOperation)
  const questionScroll = useQuestionScroll({ flowRef, contentRef, currentId, userIds: messages.filter(item => item.role === 'user').map(item => item.id), active, ready: !blocked })
  const thinking = thinkingCapability(modelConfig)
  const thinkingOn = thinking.switchable ? (thinkingMode === 'auto' ? thinking.defaultOn : thinkingMode === 'enabled') : thinking.defaultOn
  const imageReason = supportsImage ? '拍照或选择题目图片。' : '尚未开启图片支持，请在设置中确认模型能力后勾选。'
  restoredHandler.current = async (result) => {
    if (!active || !result || !supportsImage || blocked || busy) return
    const owner = useAppStore.getState().currentConversationId
    try { const file = await photoToFile(result); if (useAppStore.getState().currentConversationId === owner) chooseFile(file) }
    catch (error) { setInputError(error.userMessage || '拍摄的图片暂时没能恢复，请重新选择。') }
  }
  useEffect(() => onRestoredPhoto((result) => restoredHandler.current?.(result)), [])

  useLayoutEffect(() => {
    setDraft('')
    setMenu(null)
    setEditing(null)
    setAnswering(null)
    setClassifications({})
    setQuestionRoutes({})
    setStarring(false)
    classificationEpoch.current++
    setAttachments([])
    setPickerOpen(false)
    setCameraOpen(false)
    setCrop(null)
    setReadingImage(false)
    setInputError('')
    const frame = requestAnimationFrame(() => { if (active) inputRef.current?.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(frame)
  }, [currentId])

  useLayoutEffect(() => () => {
    imageTaskRef.current.version += 1
    imageTaskRef.current.controller?.abort()
  }, [currentId])

  useEffect(() => {
    let live = true;
    loadSkeleton().then(value => { if (live) setSkeleton(value) }).catch(() => {});
    return () => { live = false };
  }, [])
  useEffect(() => {
    if (!currentId) return;
    let live = true, request = 0;
    async function refresh() {
      if (!useAppStore.getState().storageInitialized || useAppStore.getState().dataOperation) return;
      const sequence = ++request;
      try {
        const results = await loadQuestionRoutes(currentId);
        if (live && sequence === request) setQuestionRoutes(Object.fromEntries(results.map(item => [item.messageId, item])));
      } catch { /* Background routes never interrupt reading or answering. */ }
    }
    refresh();
    const unsubscribe = onDatabaseChange(({ method }) => {
      if (['saveChanges','checkpointJob','completeJob','failJob','retryQuestionRoutes','commitImport','clearDatabase'].includes(method)) refresh();
    });
    return () => { live = false; unsubscribe() };
  }, [currentId])

  useEffect(() => () => clearTimeout(longPressRef.current?.timer), [])

  useEffect(() => {
    if (active) return
    setMenu(null); setPickerOpen(false); setCameraOpen(false); setCrop(null)
    clearLongPress()
  }, [active])
  useEffect(() => {
    if (!writing || !active) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [writing?.id, active])
  useEffect(() => {
    if (menu?.kind !== 'question') return
    const message = messages.find((item) => item.id === menu.messageId)
    if (!message) return
    refreshClassification(message, true)
    return onDatabaseChange(({ method }) => {
      if (['checkpointJob', 'completeJob', 'setQuestionStar', 'removeStarredQuestion'].includes(method)) refreshClassification(message)
    })
  }, [menu?.messageId, currentId])

  useLayoutEffect(() => {
    if (blocked || !active) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [blocked, currentId])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  }, [composerText, writing?.id])

  async function submit(event) {
    event.preventDefault()
    if (!active || !canSubmit || readingImage || busy || blocked) return
    if (editing) {
      if (editingMessage) retryOrEdit(editingMessage, editing.text, 'edit')
      return
    }
    if (answering) {
      const current = answering
      const saved = await useChatPracticeStore.getState().submit(current.id, { mode: 'steps', steps: current.text })
      if (saved && useAppStore.getState().currentConversationId === currentId) setAnswering(value => value?.id === current.id ? null : value)
      return
    }
    setInputError('')
    sendMessage(draft, attachments.length ? { attachments: attachments.map(submissionAttachment) } : undefined)
    setDraft('')
    setAttachments([])
    setPickerOpen(false)
    inputRef.current.focus({ preventScroll: true })
  }

  function openMenu(event, message) {
    if (!active || message.role !== 'user' || message.superseded || message.status === 'streaming') return
    if (event.target.closest('button,a,input,textarea,select')) return
    if (message.role === 'assistant' && !message.content) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ kind: message.role === 'user' ? 'question' : 'answer', messageId: message.id,
      anchor: { x: event.clientX || rect.left + 16, y: event.clientY || rect.top + 24 }, trigger: event.currentTarget })
  }

  async function refreshClassification(message, request = false) {
    if (!useAppStore.getState().storageInitialized || dataOperation) return
    const owner = classificationEpoch.current, id = currentId
    try {
      let result = await getMessageQuestionClassification(message.id)
      if (request && result.isMathQuestion == null) {
        await requestMessageQuestionClassification(message.id)
        result = await getMessageQuestionClassification(message.id)
      }
      if (classificationEpoch.current === owner && useAppStore.getState().currentConversationId === id) {
        setClassifications((items) => ({ ...items, [message.id]: result }))
      }
    } catch { /* A failed background tag leaves the ordinary message actions available. */ }
  }

  async function starMessage(message) {
    if (starring || blocked) return
    const owner = classificationEpoch.current
    const current = classifications[message.id]
    setStarring(true); setInputError('')
    try {
      await setQuestionStar({ messageId: message.id, starred: !current?.starred })
      await refreshClassification(message)
    } catch (failure) {
      if (owner === classificationEpoch.current) setInputError(failure.userMessage || '收藏尚未保存，请重试。')
    } finally { if (owner === classificationEpoch.current) setStarring(false) }
  }

  function retryOrEdit(message, content, action) {
    if (busy || blocked) return
    if (message.image && !supportsImage) { setInputError('请先在设置中开启当前模型的图片支持，再重新发送这道图片题。'); return }
    const pending = reviseUserMessage(message.id, content, { action, conversationId: currentId })
    if (pending) { setEditing(null); Promise.resolve(pending).catch(() => setInputError('暂时无法重新发送，请重试。')) }
  }

  const menuMessage = menu && messages.find((item) => item.id === menu.messageId)
  const menuItems = menu?.kind === 'question' && menuMessage ? [
    { label: '重试', disabled: busy || blocked, onSelect: () => retryOrEdit(menuMessage, undefined, 'retry') },
    { label: '编辑', disabled: busy || blocked, onSelect: () => { setPickerOpen(false); setAnswering(null); setEditing({ id: menuMessage.id, text: menuMessage.content || '' }) } },
    ...((classifications[menuMessage.id]?.isMathQuestion === true || menuMessage.isMathQuestion === true) ? [
      { label: classifications[menuMessage.id]?.starred ? '取消 Star 收藏' : 'Star 收藏', disabled: starring || blocked, onSelect: () => starMessage(menuMessage) },
    ] : []),
  ] : undefined

  function clearLongPress() {
    clearTimeout(longPressRef.current?.timer)
    longPressRef.current = null
  }

  function removeAttachment(id) {
    imageTaskRef.current.version += 1
    imageTaskRef.current.controller?.abort()
    setAttachments((items) => items.filter((item) => item.id !== id))
    setReadingImage(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function openCrop(attachment) {
    if (attachment.kind !== 'image' || attachment.documentImage || readingImage || busy || blocked) return
    const ownerId = useAppStore.getState().currentConversationId
    await hideInputKeyboard(inputRef.current).catch(() => {})
    if (useAppStore.getState().currentConversationId !== ownerId) return
    setPickerOpen(false)
    setCrop({ attachment, ownerId })
  }

  function applyCrop(attachment) {
    if (!crop || crop.ownerId !== useAppStore.getState().currentConversationId) return
    setAttachments((items) => items.map((item) => item.id === crop.attachment.id ? attachment : item))
    setCrop(null)
  }

  async function chooseFile(file, sourceUri) {
    if (!file) return
    if (busy || blocked) return
    const ownerId = useAppStore.getState().currentConversationId
    const version = ++imageTaskRef.current.version
    const controller = new AbortController()
    imageTaskRef.current.controller?.abort()
    imageTaskRef.current.controller = controller
    setInputError('')
    setMenu(null)
    setReadingImage(true)
    setReadProgress('正在读取附件…')
    try {
      const result = await readAttachment(file, { signal: controller.signal, supportsImage, onProgress: (progress) => {
        if (imageTaskRef.current.version === version) setReadProgress(progress)
      } })
      if (imageTaskRef.current.version !== version) return
      const current = useAppStore.getState()
      if (current.currentConversationId !== ownerId || current.route !== 'main' || current.activeArea !== 'ask') return
      const documentImages = result.some((item) => item.kind === 'document')
      const prepared = result.map((item) => ({ ...item, ...(sourceUri ? { sourceUri } : {}), ...(documentImages && item.kind === 'image' ? { documentImage: true } : {}) }))
      setAttachments((items) => [...items, ...prepared])
      if (!isNative()) setRecentPhotos((items) => [...prepared.filter((item) => item.kind === 'image' && !item.documentImage), ...items].slice(0,12))
    } catch (error) {
      if (imageTaskRef.current.version !== version || controller.signal.aborted) return
      setInputError(error.userMessage || (/^[\u4e00-\u9fff]/.test(error.message ?? '') ? error.message : '附件读取失败，请检查文件是否损坏，或换一个格式后重试。'))
    } finally {
      if (imageTaskRef.current.version === version) setReadingImage(false)
    }
  }

  async function pickPhoto(source) {
    if (!isNative()) { if(source==='camera')setCameraOpen(true);else galleryRef.current?.click();return }
    if (!supportsImage || busy || blocked) return
    const owner = useAppStore.getState().currentConversationId
    try {
      const file = await pickNativePhoto(source)
      const current = useAppStore.getState()
      if (file && current.currentConversationId === owner && current.route === 'main' && current.activeArea === 'ask') chooseFile(file)
    } catch (error) { setInputError(error.userMessage || '暂时无法打开相机或相册。') }
  }

  async function openPicker() {
    if (pickerOpen) { setPickerOpen(false); return }
    setInputError('')
    await hideInputKeyboard(inputRef.current).catch(() => {})
    setPickerOpen(true)
    if (isNative() && supportsImage) {
      const owner = useAppStore.getState().currentConversationId
      const photos = await recentNativePhotos().catch(() => [])
      if (useAppStore.getState().currentConversationId === owner) setRecentPhotos(photos)
    }
  }

  useEffect(() => {
    if (!pickerOpen) return
    const close = (event) => { if (event.key === 'Escape') { event.preventDefault(); setPickerOpen(false) } }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [pickerOpen])

  return (
    <div className="ask-page flex min-h-0 flex-1 flex-col">
      <div ref={flowRef} className="conversation-flow" role="log" aria-label="对话" aria-live="polite" aria-relevant="additions"
        onScroll={questionScroll.onScroll}>
        <div ref={contentRef} className="conversation-content">
        {conversationLoading && <p className="muted message-status" role="status">正在读取会话…</p>}
        {messages.map((message) => {
          const versions = message.role === 'user' ? revisionVersions(allMessages, message.id) : []
          const versionIndex = versions.findIndex(item => item.id === message.id)
          const switchVersion = (offset) => { if (selectMessageRevision(versions[versionIndex + offset]?.id)) { setMenu(null); setEditing(null); setAnswering(null) } }
          return <Fragment key={message.id}><article className={`message message-${message.role}`} aria-label={message.role === 'user' ? '你的消息' : '助手的消息'}
            data-user-message-id={message.role === 'user' ? message.id : undefined}
            aria-busy={message.status === 'streaming' || undefined} tabIndex={message.role === 'user' ? 0 : undefined}
            aria-haspopup={message.role === 'user' ? 'menu' : undefined}
            onContextMenu={message.role === 'user' ? (event) => openMenu(event, message) : undefined}
            onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, message) }}
            onPointerDown={(event) => {
              if (message.role !== 'user' || event.button > 0 || event.target.closest('button,a,input,textarea,select')) return
              const trigger = event.currentTarget
              const anchor = { x: event.clientX, y: event.clientY }
              clearLongPress()
              longPressRef.current = { ...anchor, timer: setTimeout(() => {
                if (message.status !== 'streaming') setMenu({ kind: 'question', messageId: message.id, anchor, trigger })
              }, 500) }
            }}
            onPointerMove={(event) => { if (longPressRef.current && (Math.abs(event.clientX - longPressRef.current.x) > 10 || Math.abs(event.clientY - longPressRef.current.y) > 10)) clearLongPress() }}
            onPointerUp={clearLongPress} onPointerCancel={clearLongPress}>
            {(message.attachments ?? (message.image ? [{ ...message.image, kind: 'image' }] : [])).map((attachment) => attachment.kind === 'image'
              ? <img key={attachment.id} className="message-image" src={attachment.dataUrl} alt="题目原图" />
              : <div key={attachment.id} className="message-document"><FileText size={20} /><span>{attachment.name}</span></div>)}
            {message.practiceItemId ? <ChatPracticeCard itemId={message.practiceItemId} onWrite={(id) => { setEditing(null); setPickerOpen(false); setAnswering({ id, text: useChatPracticeStore.getState().items[id]?.answer?.steps || '' }) }} />
              : message.content && <MathMarkdown streaming={message.status === 'streaming'}>{message.content}</MathMarkdown>}
            {!message.content && message.status === 'streaming' && <ThinkingIndicator />}
            {message.error && <p className="muted message-status" role="status">{message.error}</p>}
          </article>
          {message.role === 'user' && questionRoutes[message.id] && <QuestionRoutePanel key={`${message.id}:route`} result={questionRoutes[message.id]} skeleton={skeleton} />}
          {versions.length > 1 && <nav className="message-version-controls" aria-label="消息版本" data-no-area-swipe>
            <button type="button" className="icon-button" aria-label="上一版问答" disabled={busy || blocked || versionIndex <= 0} onClick={() => switchVersion(-1)}><ChevronLeft size={17} /></button>
            <span aria-live="polite">{versionIndex + 1} / {versions.length}</span>
            <button type="button" className="icon-button" aria-label="下一版问答" disabled={busy || blocked || versionIndex >= versions.length - 1} onClick={() => switchVersion(1)}><ChevronRight size={17} /></button>
          </nav>}</Fragment>
        })}
        </div>
        <div className="conversation-tail" aria-hidden="true" style={{ height: questionScroll.space }} />
      </div>
      <form className="composer" onSubmit={submit} aria-label={editing ? '编辑消息' : answering ? '聊天练习作答' : '题目输入'}>
        {editing && <div className="composer-edit-heading"><span className="muted">正在编辑消息 · 发送后重新回答</span><button type="button" className="icon-button" aria-label="取消编辑" onClick={() => setEditing(null)}><X size={16} /></button></div>}
        {answering && <div className="composer-edit-heading"><span className="muted">正在写这道题的关键步骤</span><button type="button" className="icon-button" disabled={practiceBusy} aria-label="取消作答" onClick={() => setAnswering(null)}><X size={16} /></button></div>}
        {!writing && (attachments.length > 0 || readingImage) && <div className="composer-attachments">
          {attachments.map((attachment) => <div className="composer-attachment" key={attachment.id}>
            {attachment.kind === 'image' ? (attachment.documentImage ? <img src={attachment.dataUrl} alt="待发送的文档图片" />
              : <button type="button" className="composer-crop-preview" aria-label={`裁切图片 ${attachment.name}`} disabled={readingImage || busy || blocked} onClick={() => openCrop(attachment)}><img src={attachment.dataUrl} alt="待发送的图片" /><span>{attachment.cropSource ? '已裁切 · 编辑' : '裁切'}</span></button>) : <span className="attachment-filename"><FileText size={18} />{attachment.name}</span>}
            <button type="button" className="icon-button attachment-remove" aria-label={`移除${attachment.kind === 'image' ? '图片' : '文件'}`} onClick={() => removeAttachment(attachment.id)}><X size={16} /></button>
          </div>)}
          {readingImage && <span className="muted" role="status">{readProgress}</span>}
        </div>}
        <div className="composer-row">
        <span className="attachment-action">
          <button className="icon-button" type="button" disabled={busy || blocked || Boolean(writing)} aria-label="添加附件" aria-expanded={pickerOpen} aria-controls="attachment-panel"
            onPointerDown={(event) => event.preventDefault()} onClick={openPicker}>
            <Plus className={`attachment-plus${pickerOpen ? ' is-open' : ''}`} size={20} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </span>
        <textarea ref={inputRef} value={composerText} onChange={(event) => editing ? setEditing({ ...editing, text: event.target.value }) : answering ? setAnswering({ ...answering, text: event.target.value }) : setDraft(event.target.value)}
          onFocus={() => setPickerOpen(false)}
          rows={1} aria-label={editing ? '修改题目' : answering ? '你的关键步骤' : '输入题目'} placeholder={editing ? '修改内容后发送…' : answering ? '写下关键变形和使用条件…' : '输入题目…'} disabled={blocked || practiceBusy}
          onPaste={(event) => {
            const file = [...(event.clipboardData?.files ?? [])][0]
            if (file) { event.preventDefault(); if (!writing) chooseFile(file) }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && editing) { event.preventDefault(); setEditing(null); return }
            if (event.key === 'Escape' && answering && !practiceBusy) { event.preventDefault(); setAnswering(null); return }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submit(event)
          }} />
        {busy ? <button key="stop" className="send-button" type="button" aria-label={practiceBusy ? '停止检查' : '停止回答'} onClick={(event) => { event.preventDefault(); practiceBusy ? useChatPracticeStore.getState().cancel(answering.id) : stopGenerating() }}><Square size={14} strokeWidth={1.8} aria-hidden="true" /></button>
          : <button key="send" className="send-button" type="submit" aria-label={editing ? '保存并重发' : answering ? '提交关键步骤' : '发送消息'} disabled={!canSubmit || readingImage || blocked}><ArrowUp size={20} strokeWidth={1.8} aria-hidden="true" /></button>}
        </div>
        <div className="composer-footer">
          {!answering && <div className="composer-tools"><ThinkingSwitch checked={thinkingOn}
            disabled={!thinking.switchable || busy || blocked}
            description={thinking.switchable ? '控制下一次问答的思考模式；可点击或左右拨动' : thinking.reason}
            status={thinking.switchable ? '' : thinking.defaultOn ? '固定开启' : '不可切换'}
            onChange={enabled => setAnswerThinking(enabled ? 'enabled' : 'disabled')} /></div>}
          {messages.filter(item => item.role === 'user').length > 1 && <nav className="question-navigation" aria-label="定位用户输入" data-no-area-swipe>
        <button type="button" className="icon-button" aria-label="上一个输入" disabled={!questionScroll.navigation.previous} onClick={() => questionScroll.navigate(-1)}><ChevronUp size={17} /></button>
        <button type="button" className="icon-button" aria-label="下一个输入" disabled={!questionScroll.navigation.next} onClick={() => questionScroll.navigate(1)}><ChevronDown size={17} /></button>
      </nav>}
        </div>
        {(inputError || (conversation?.loaded === false && !conversationLoading && storageError)) && <p className="composer-feedback muted" role="status">{inputError || storageError}</p>}
        <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
        <input ref={fileRef} type="file" accept={FILE_ACCEPT} hidden onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
      </form>
      <AnimatedDisclosure open={pickerOpen} id="attachment-panel" className="attachment-disclosure"><section className="attachment-panel" aria-label="添加附件面板">
        <div className="attachment-panel-heading"><span className="muted">{isNative() ? '最近图片' : '最近选用的图片'}</span><button type="button" className="icon-button" aria-label="关闭附件面板" onClick={() => setPickerOpen(false)}><X size={18} /></button></div>
        {recentPhotos.length > 0 && <div className="recent-photo-row">{recentPhotos.map((photo) => {
          const selected = attachments.some((item) => matchesPendingPhoto(item, photo))
          return <button type="button" key={photo.uri || photo.id} className={`recent-photo${selected ? ' is-selected' : ''}`} disabled={readingImage} aria-label={`选择图片 ${photo.name || ''}`} aria-pressed={selected}
            onClick={async () => {
              if (selected) { setAttachments((items) => items.filter((item) => !matchesPendingPhoto(item, photo))); return }
              if (photo.uri) { const owner=useAppStore.getState().currentConversationId;try { const file = await photoToFile({ uri: photo.uri });if(useAppStore.getState().currentConversationId===owner)await chooseFile(file, photo.uri) } catch { if(useAppStore.getState().currentConversationId===owner)setInputError('图片无法读取，请从相册重新选择。') } }
              else setAttachments((items) => [...items, photo])
            }}><img src={photo.thumbnail || photo.dataUrl} alt="" /><span className="recent-photo-check" aria-hidden="true">{selected ? '✓' : ''}</span></button>
        })}</div>}
        <div className="attachment-panel-actions">
          <button type="button" disabled={!supportsImage || readingImage} title={imageReason} onClick={() => pickPhoto('camera')}><Camera size={24} />拍照</button>
          <button type="button" disabled={!supportsImage || readingImage} title={imageReason} onClick={() => pickPhoto('gallery')}><ImageIcon size={24} />相册</button>
          <button type="button" disabled={readingImage} onClick={() => fileRef.current?.click()}><Paperclip size={24} />文件</button>
        </div>
      </section></AnimatedDisclosure>
      {active && menu && <MessageMenu {...menu} items={menuItems} disabled={busy || blocked} onClose={() => setMenu(null)} />}
      {cameraOpen && <Suspense fallback={null}><CameraCapture onClose={() => setCameraOpen(false)} onPhoto={(file) => { setCameraOpen(false);chooseFile(file) }} /></Suspense>}
      {crop && <Suspense fallback={null}><ImageCrop attachment={crop.attachment} onClose={() => setCrop(null)} onApply={applyCrop} onRestore={applyCrop} /></Suspense>}
    </div>
  )
}
