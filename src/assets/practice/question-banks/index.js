import bank402 from './bank402.json' with { type: 'json' };
import bank2027a from './bank2027a.json' with { type: 'json' };

// To append a future compiled dataset, import its JSON and add it here. Never
// replace bank402 or silently regenerate the IDs of earlier questions.
// bank2027a：由骨架自带种子题加工（独立命名空间，不覆盖 bank402）。
export const questionBanks = [bank402, bank2027a];
export const questionBankTaxonomy = {
  groups: bank402.taxonomy.groups,
  scenarioById: new Map(questionBanks.flatMap((bank) => bank.taxonomy.scenarios).map((scene) => [scene.id, scene])),
  blockById: new Map(questionBanks.flatMap((bank) => bank.taxonomy.blocks ?? []).map((block) => [block.id, block])),
};
