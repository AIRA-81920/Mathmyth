// Message text changes on every streamed frame. History only needs these fields.
export function createHistorySelector() {
  let input, summaries = [];
  const fields = ['id', 'title', 'updatedAt', 'pinned', 'methodId', 'ephemeral', 'messageCount'];
  return state => {
    if (state.conversations === input) return summaries;
    input = state.conversations;
    const previous = new Map(summaries.map(item => [item.id, item]));
    const next = input.map(conversation => {
      const summary = { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt,
        pinned: conversation.pinned, methodId: conversation.methodId, ephemeral: conversation.ephemeral,
        messageCount: conversation.loaded === false ? conversation.messageCount : conversation.messages?.length,
        loaded: false };
      const old = previous.get(summary.id);
      return old && fields.every(key => old[key] === summary[key]) ? old : summary;
    });
    if (next.length !== summaries.length || next.some((item, index) => item !== summaries[index])) summaries = next;
    return summaries;
  };
}
