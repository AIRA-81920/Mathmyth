export function practiceChoiceFor(choices, { scenarioId, methodId, scenarioIds = [] }) {
  if (scenarioId) return choices.find(choice => choice.scenarioId === scenarioId);
  return choices.find(choice => choice.methodId === methodId)
    ?? choices.find(choice => scenarioIds.includes(choice.scenarioId));
}
