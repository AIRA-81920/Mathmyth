// 题库数据按学科分开：高数读 route-bank.js，高中数学读 route-bank-hs.js。
// 两者都很大，仍然用带缓存的动态 import，避免主线程和 DB Worker 各自静态内联。
import { getActiveSubject } from '../config/subject.js';

const caches = new Map();
// 用字面量动态 import，Vite 才能在构建期把两个题库拆成独立 chunk。
const loaders = {
  advanced: () => import('../../assets/practice/route-bank.js'),
  high_school: () => import('../../assets/practice/route-bank-hs.js'),
};

// 返回缓存的 Promise：首次调用触发一次动态加载，后续复用同一个 Promise。
// 加载失败时清空该学科的缓存，使得下一次调用可以重新尝试。
export function loadRouteBank() {
  const subject = getActiveSubject() === 'high_school' ? 'high_school' : 'advanced';
  if (!caches.has(subject)) {
    caches.set(subject, loaders[subject]().catch((error) => {
      caches.delete(subject);
      throw error;
    }));
  }
  return caches.get(subject);
}
