import { Capacitor } from '@capacitor/core';
import { ImageInputError } from '../images/input.js';

export const isNative = () => Capacitor.isNativePlatform();
let pendingPhoto;
const restoredListeners = new Set();
export function receiveRestoredPhoto(result) {
  pendingPhoto = result;
  for (const listener of restoredListeners) { const photo = pendingPhoto; pendingPhoto = null; listener(photo); break; }
}
export function onRestoredPhoto(listener) {
  restoredListeners.add(listener);
  // Defer delivery beyond StrictMode's effect teardown/re-setup.
  queueMicrotask(() => { if (restoredListeners.has(listener) && pendingPhoto) { const photo = pendingPhoto; pendingPhoto = null; listener(photo); } });
  return () => restoredListeners.delete(listener);
}
export async function photoToFile(result, { signal } = {}) {
  if (!result?.uri) throw new ImageInputError('没有读取到拍摄的图片，请重新选择。', 'read_failed');
  const { Filesystem } = await import('@capacitor/filesystem');
  const { data } = await Filesystem.readFile({ path: result.uri });
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (typeof data !== 'string') throw new ImageInputError('图片读取失败，请重新选择。', 'read_failed');
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const format = result.metadata?.format || 'jpg';
  return new File([bytes], `题目-${Date.now()}.${format}`);
}
export async function pickNativePhoto(source) {
  const { Camera, CameraDirection } = await import('@capacitor/camera');
  try {
    const options = { quality: 100, saveToGallery: false, includeMetadata: true };
    const result = source === 'camera' ? await Camera.takePhoto({ ...options, cameraDirection: CameraDirection.Rear })
      : (await Camera.chooseFromGallery({ ...options, allowMultipleSelection: false, limit: 1 })).results[0];
    return result ? await photoToFile(result) : null;
  } catch (error) {
    if (['OS-PLUG-CAMR-0006','OS-PLUG-CAMR-0020'].includes(error.code) || /cancel/i.test(error.message || '')) return null;
    if (error instanceof ImageInputError) throw error;
    throw new ImageInputError(['OS-PLUG-CAMR-0003','OS-PLUG-CAMR-0005'].includes(error.code)
      ? '相机或图片访问被拒绝，请在系统设置中允许后重试。' : '暂时无法打开相机或相册，请重新选择。', 'native_camera');
  }
}
