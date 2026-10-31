// 关闭/隐藏应用前要收掉进行中的练习判定，并把「独立练习」还没到点的草稿立刻写掉。
// 注册式接线（与 draftFlush 同一手法）让 appStore / lifecycle 不必静态 import 练习 store，
// 避免 appStore ↔ practiceStore 的循环依赖。
let cancelAll = () => {};
let flushDrafts = async () => true;
export function registerPracticeExitCancel(callback) { cancelAll = callback; }
export function registerPracticeExitFlush(callback) { flushDrafts = callback; }
export function cancelPracticeRequests() { return cancelAll(); }
export function flushIndependentPracticeDrafts() { return flushDrafts(); }
