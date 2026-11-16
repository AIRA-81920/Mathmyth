import { createSkeleton } from './index.js';
import { getActiveSubject } from '../config/subject.js';

// 每个学科一套独立目录。import.meta.glob 在构建期展开，两套资产都会进包，
// 但只有被选中的那套会被 createSkeleton 解析成索引。
const loaders = {
  advanced: import.meta.glob('../../assets/skeleton/*.json', { import: 'default' }),
  high_school: import.meta.glob('../../assets/skeleton-hs/*.json', { import: 'default' }),
};

// 缓存按学科分开：切回已加载过的学科时直接复用，不会把两套 ID 混进同一个索引。
const caches = new Map();
export function loadSkeleton(subject = getActiveSubject()) {
  const key = subject === 'high_school' ? 'high_school' : 'advanced';
  if (!caches.has(key)) {
    caches.set(key, Promise.all(Object.entries(loaders[key]).map(async ([path, read]) => [path, await read()]))
      .then((entries) => {
        const skeleton = createSkeleton(Object.fromEntries(entries));
        // 学科挂在骨架实例上：知识关系/具体结构都按"这套骨架属于哪个学科"取数据，
        // 不再依赖某个全局变量在什么时刻被设置。
        skeleton.subject = key;
        return skeleton;
      })
      .catch((error) => { caches.delete(key); throw error; }));
  }
  return caches.get(key);
}
