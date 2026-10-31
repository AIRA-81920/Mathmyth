// 布局断点的唯一真源：CSS 里的 @media 和这里的 matchMedia 必须用同一个数字，
// 否则会出现「CSS 已经切成宽屏布局、JS 还以为在手机上」的错位（抽屉 inert、动画照跑）。
import { useEffect, useState } from 'react';

// ≥1100px：抽屉变成常驻左侧栏（桌面、平板横屏）。
// <1100px：覆盖式抽屉 + 满宽内容（手机竖屏、平板竖屏、窄窗口）。
export const WIDE_QUERY = '(min-width: 1100px)';

export function useWideLayout() {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(WIDE_QUERY)?.matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.(WIDE_QUERY);
    if (!query) return;
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);
  return wide;
}
