// 学科注册表：一个学科对应一套独立的骨架资产与一套提示词口吻。
// ID 保持英文常量，写入设置后不随界面文案变化；名称只用于展示。
export const SUBJECTS = [
  {
    id: 'advanced', name: '高等数学', shortName: '高数', audience: '大一学生',
    description: '同济《高等数学》第七版 · 上册 + 下册',
  },
  {
    id: 'high_school', name: '高中数学', shortName: '高中数学', audience: '高中生',
    description: '人教A版 2019 · 高考范围 · 五册教材',
  },
];

const subjectIds = new Set(SUBJECTS.map((entry) => entry.id));
export const DEFAULT_SUBJECT = 'advanced';

// 旧数据没有学科字段时一律按高数处理，保证升级后行为不变。
export function normalizeSubject(value) {
  return subjectIds.has(value) ? value : DEFAULT_SUBJECT;
}

// 当前学科放在模块级变量里：骨架加载、AI 提示词都是同步读取，
// 而设置项由 Zustand 异步初始化，所以需要一个不依赖 React 的当前值。
let activeSubject = DEFAULT_SUBJECT;

export function getActiveSubject() {
  return activeSubject;
}

export function setActiveSubject(value) {
  activeSubject = normalizeSubject(value);
  return activeSubject;
}

// 由知识节点 ID 反推学科：高中数学统一使用 S./G./M./B. + hs_ 的命名空间。
// 用于“记录创建后用户切换了学科”的场景，保证数据仍归原本的学科。
export function subjectForNodeId(id) {
  return /^[A-Z]\.hs_/.test(String(id ?? '')) ? 'high_school' : 'advanced';
}

export function subjectMeta(value = activeSubject) {
  return SUBJECTS.find((entry) => entry.id === normalizeSubject(value)) ?? SUBJECTS[0];
}

export function subjectName(value = activeSubject) {
  return subjectMeta(value).shortName;
}
