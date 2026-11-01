const practiceBusy = state => Boolean(state.generating || state.modelBusy);
const chatBusy = state => Object.values(state.checking ?? {}).some(Boolean);

export function createForegroundSignals(practiceStore, chatPracticeStore) {
  return {
    isForegroundBusy: () => practiceBusy(practiceStore.getState()) || chatBusy(chatPracticeStore.getState()),
    // 诊断用：只读地摊开"忙"的三个来源，不参与任何判断。
    foregroundStores: () => ({ practice: practiceStore.getState(), chat: chatPracticeStore.getState() }),
    subscribeForeground(listener) {
      const offPractice = practiceStore.subscribe((state, previous) => {
        if (state.generating !== previous.generating || state.modelBusy !== previous.modelBusy) listener();
      });
      const offChat = chatPracticeStore.subscribe((state, previous) => {
        if (state.checking !== previous.checking && chatBusy(state) !== chatBusy(previous)) listener();
      });
      return () => { offPractice(); offChat(); };
    },
  };
}
