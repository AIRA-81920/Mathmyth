import { Capacitor } from '@capacitor/core';
import { useAppStore } from '../../store/appStore.js';
import { usePracticeStore } from '../../store/practiceStore.js';
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
export async function startNativeLifecycle() {
  if (!Capacitor.isNativePlatform()) return () => {};
  const { App } = await import('@capacitor/app');
  const handles = await Promise.all([
    App.addListener('backButton', () => handleBack({ minimize: () => App.minimizeApp() })),
    App.addListener('appStateChange', ({ isActive }) => { if (!isActive) useAppStore.getState().flushStorage().catch(() => {}); }),
    App.addListener('appRestoredResult', (result) => {
      if (result.pluginId === 'Camera' && result.success && ['takePhoto','chooseFromGallery'].includes(result.methodName)) {
        receiveRestoredPhoto(result.methodName === 'takePhoto' ? result.data : result.data?.results?.[0]);
      }
    }),
  ]);
  return () => handles.forEach((handle) => handle.remove());
}
