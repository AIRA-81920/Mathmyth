import { Capacitor } from '@capacitor/core';
import { useAppStore } from '../../store/appStore.js';
import { usePracticeStore } from '../../store/practiceStore.js';
import { useChatPracticeStore } from '../../store/chatPracticeStore.js';
import { receiveRestoredPhoto } from './photos.js';

export function handleBack({ app = useAppStore, practice = usePracticeStore, document: page = globalThis.document, minimize = () => {} } = {}) {
  const overlay = [...(page?.querySelectorAll('[role="dialog"], [role="menu"]') ?? [])].find((node) =>
    node.getClientRects().length && !node.closest('[aria-hidden="true"], [inert]') && getComputedStyle(node).visibility !== 'hidden');
  if (overlay) {
    (page.activeElement || page).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return;
  }
  const attachments = page?.querySelector('[aria-label="关闭附件面板"]');
  if (attachments) { attachments.click(); return; }
  const state = app.getState();
  if (state.dataOperation) return;
  if (state.drawerOpen) { state.setDrawerOpen(false); return; }
  if (state.route === 'settings') { page?.querySelector('[aria-label="返回"]:not(:disabled)')?.click(); return; }
  if (state.route === 'method') { state.closeMethod(); return; }
  if (state.route === 'scenario') { state.closeScenario(); return; }
  if (state.activeArea === 'practice' && practice.getState().screen !== 'entry') {
    practice.getState().cancel(); practice.getState().showEntry(); return;
  }
  if (state.activeArea !== 'ask') { state.setActiveArea('ask'); return; }
  minimize();
}
// 网页与桌面端：切回标签页/窗口时同样尝试一次自动重连（与原生"回前台"等价）。
// 重复触发是安全的：同一回答只会被自动重连一次，且仍有请求在跑时会直接跳过。
export function startVisibilityLifecycle(page = globalThis.document) {
  if (!page?.addEventListener) return () => {};
  // 隐藏/关闭时两类练习草稿都要落盘：聊天随练的 350ms 防抖，与独立练习的 350ms 节流。
  const flush = () => {
    useChatPracticeStore.getState().flushDrafts().catch(() => {});
    usePracticeStore.getState().flushDrafts().catch(() => {});
  };
  const onVisible = () => {
    if (page.visibilityState === 'visible') useAppStore.getState().resumeInterruptedRequests();
    else flush();
  };
  page.addEventListener('visibilitychange', onVisible);
  globalThis.addEventListener?.('pagehide', flush);
  return () => { page.removeEventListener('visibilitychange', onVisible); globalThis.removeEventListener?.('pagehide', flush); };
}
export async function startNativeLifecycle() {
  if (!Capacitor.isNativePlatform()) return () => {};
  const { App } = await import('@capacitor/app');
  const handles = await Promise.all([
    App.addListener('backButton', () => handleBack({ minimize: () => App.minimizeApp() })),
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) useChatPracticeStore.getState().flushDrafts()
        .then(() => usePracticeStore.getState().flushDrafts())
        .then(() => useAppStore.getState().flushStorage()).catch(() => {});
      // D11：回到前台时如果上一个回答还卡在临死状态（WebView 被系统冻结、socket
      // 被掐断，错误事件没被处理），自动按同样的问答序列重连一次。
      else useAppStore.getState().resumeInterruptedRequests();
    }),
    App.addListener('appRestoredResult', (result) => {
      if (result.pluginId === 'Camera' && result.success && ['takePhoto','chooseFromGallery'].includes(result.methodName)) {
        receiveRestoredPhoto(result.methodName === 'takePhoto' ? result.data : result.data?.results?.[0]);
      }
    }),
  ]);
  return () => handles.forEach((handle) => handle.remove());
}
