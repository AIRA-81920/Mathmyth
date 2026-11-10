import bank402 from './bank402.json' with { type: 'json' };
import bank2027a from './bank2027a.json' with { type: 'json' };
import bankadv1 from './bankadv1.json' with { type: 'json' };
import bankadv2 from './bankadv2.json' with { type: 'json' };
import bankadv3 from './bankadv3.json' with { type: 'json' };
import bankadv4 from './bankadv4.json' with { type: 'json' };
import bankadv5 from './bankadv5.json' with { type: 'json' };
import bankadv6 from './bankadv6.json' with { type: 'json' };
import bankadv7 from './bankadv7.json' with { type: 'json' };
import bankadv10 from './bankadv10.json' with { type: 'json' };
import bankadv11 from './bankadv11.json' with { type: 'json' };
import bankadv12 from './bankadv12.json' with { type: 'json' };
import bankadv13 from './bankadv13.json' with { type: 'json' };
import bankadv14 from './bankadv14.json' with { type: 'json' };
import bankadv17 from './bankadv17.json' with { type: 'json' };
import bankadv18 from './bankadv18.json' with { type: 'json' };
import bankadv19 from './bankadv19.json' with { type: 'json' };
import bankadv20 from './bankadv20.json' with { type: 'json' };
import bankadv21 from './bankadv21.json' with { type: 'json' };
import bankadv24 from './bankadv24.json' with { type: 'json' };
import bankadv25 from './bankadv25.json' with { type: 'json' };
import bankadv26 from './bankadv26.json' with { type: 'json' };
import bankadv27 from './bankadv27.json' with { type: 'json' };
import bankadv28 from './bankadv28.json' with { type: 'json' };
import bankadv31 from './bankadv31.json' with { type: 'json' };
import bankadv32 from './bankadv32.json' with { type: 'json' };
import bankadv34 from './bankadv34.json' with { type: 'json' };
import bankadv35 from './bankadv35.json' with { type: 'json' };
import bankadv38 from './bankadv38.json' with { type: 'json' };
import bankadv39 from './bankadv39.json' with { type: 'json' };
import bankadv40 from './bankadv40.json' with { type: 'json' };
import bankadv41 from './bankadv41.json' with { type: 'json' };
import bankadv42 from './bankadv42.json' with { type: 'json' };

// To append a future compiled dataset, import its JSON and add it here. Never
// replace bank402 or silently regenerate the IDs of earlier questions.
// bank2027a：由骨架自带种子题加工（独立命名空间，不覆盖 bank402）。
// bankadv1–bankadv7：按七题组从公开高校期末卷补题，逐题审核后编译接入。
export const questionBanks = [bank402, bank2027a, bankadv1, bankadv2, bankadv3, bankadv4, bankadv5, bankadv6, bankadv7, bankadv10, bankadv11, bankadv12, bankadv13, bankadv14, bankadv17, bankadv18, bankadv19, bankadv20, bankadv21, bankadv24, bankadv25, bankadv26, bankadv27, bankadv28, bankadv31, bankadv32, bankadv34, bankadv35, bankadv38, bankadv39, bankadv40, bankadv41, bankadv42];
export const questionBankTaxonomy = {
  groups: bank402.taxonomy.groups,
  scenarioById: new Map(questionBanks.flatMap((bank) => bank.taxonomy.scenarios).map((scene) => [scene.id, scene])),
  blockById: new Map(questionBanks.flatMap((bank) => bank.taxonomy.blocks ?? []).map((block) => [block.id, block])),
};
