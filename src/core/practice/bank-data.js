// 题库数据（route-bank.js 及其内联的 bank402/bank2027a JSON）体积约 3.4MB。
// 这里用一个带缓存的动态 import 作为唯一入口，避免主线程与 DB Worker 在打包时
// 各自静态内联一份，把题库推迟到真正需要（进入练习页/聊天随练/提交本地题）时再加载。
let cached;

// 返回缓存的 Promise：首次调用触发一次动态加载，后续复用同一个 Promise。
// 加载失败时清空缓存，使得下一次调用可以重新尝试，而不是永久缓存一个已失败的 Promise。
export function loadRouteBank() {
  if (!cached) {
    cached = import('../../assets/practice/route-bank.js').catch((error) => {
      cached = undefined;
      throw error;
    });
  }
  return cached;
}
