import { useAppStore } from './appStore.js';
import { pickTourQuestion, writePendingGuide } from '../core/onboarding/questionPool.js';

// 引导开场必须同时满足三件事，缺一件用户看到的就是"空的输入框"或者被丢在练习/足迹页：
//   ① 停在主界面的「问答」区，并且是一个全新会话 —— 引导结束时这一整段会被删掉，
//      绝不能删到用户自己带着历史的那条对话；
//   ② 输入框里已经有一道示例题（锁住，用户只需要点发送）；
//   ③ 思考模式打开：这题本来就值得多想一会儿，也顺便让用户看到它在哪。
// 首启（Onboarding）和"从设置里重看"走同一个开场，两条路的初始化不会各自漂移。
export function primeTour() {
  const store = useAppStore.getState();
  // 正在导入/删除数据时别抢状态：那一刻 newConversation 会被拦下，
  // 结果是引导开着、输入框却是空的。
  if (store.dataOperation) return null;
  store.newConversation();
  const fresh = useAppStore.getState();
  const question = pickTourQuestion(fresh.preferences?.subject).question;
  fresh.setAnswerThinking('enabled');
  fresh.setGuidedComposer(question, fresh.currentConversationId);
  // 记一份"引导进行中"：中途被刷新或系统回收，下次进来还能接着走。
  writePendingGuide(question);
  return question;
}
