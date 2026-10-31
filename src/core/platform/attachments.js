import { Capacitor, registerPlugin } from '@capacitor/core';
const media = registerPlugin('MathmythMedia');
export async function hideInputKeyboard(input) {
  input?.blur();
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('MathmythMedia')) await media.hideKeyboard();
}
export async function recentNativePhotos() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MathmythMedia')) return { photos: [], denied: false };
  const result = await media.recentPhotos();
  return { photos: result?.photos ?? [], denied: result?.denied === true };
}
