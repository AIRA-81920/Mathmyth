// 高中数学题库注册表。由 metadata/generate_hs_index.py 自动生成，请勿手改。
// 与高数题库分开导入，避免两套 taxonomy 混在一起。
import bankhs1 from './bankhs1.json' with { type: 'json' };
import bankhs2 from './bankhs2.json' with { type: 'json' };
import bankhs3 from './bankhs3.json' with { type: 'json' };
import bankhs4 from './bankhs4.json' with { type: 'json' };
import bankhs5 from './bankhs5.json' with { type: 'json' };
import bankhs6 from './bankhs6.json' with { type: 'json' };
import bankhs7 from './bankhs7.json' with { type: 'json' };
import bankhs8 from './bankhs8.json' with { type: 'json' };
import bankhs9 from './bankhs9.json' with { type: 'json' };
import bankhs10 from './bankhs10.json' with { type: 'json' };
import bankhs11 from './bankhs11.json' with { type: 'json' };
import bankhs12 from './bankhs12.json' with { type: 'json' };
import bankhs13 from './bankhs13.json' with { type: 'json' };
import bankhs14 from './bankhs14.json' with { type: 'json' };
import bankhs15 from './bankhs15.json' with { type: 'json' };
import bankhs16 from './bankhs16.json' with { type: 'json' };
import bankhs17 from './bankhs17.json' with { type: 'json' };
import bankhs18 from './bankhs18.json' with { type: 'json' };
import bankhs19 from './bankhs19.json' with { type: 'json' };
import bankhs20 from './bankhs20.json' with { type: 'json' };
import bankhs21 from './bankhs21.json' with { type: 'json' };
import bankhs22 from './bankhs22.json' with { type: 'json' };
import bankhs23 from './bankhs23.json' with { type: 'json' };
import bankhs24 from './bankhs24.json' with { type: 'json' };
import bankhs25 from './bankhs25.json' with { type: 'json' };
import bankhs26 from './bankhs26.json' with { type: 'json' };
import bankhs27 from './bankhs27.json' with { type: 'json' };
import bankhs28 from './bankhs28.json' with { type: 'json' };
import bankhs29 from './bankhs29.json' with { type: 'json' };
import bankhs30 from './bankhs30.json' with { type: 'json' };
import bankhs31 from './bankhs31.json' with { type: 'json' };
import bankhs32 from './bankhs32.json' with { type: 'json' };
import bankhs33 from './bankhs33.json' with { type: 'json' };
import bankhs34 from './bankhs34.json' with { type: 'json' };
import bankhs35 from './bankhs35.json' with { type: 'json' };
import bankhs36 from './bankhs36.json' with { type: 'json' };
import bankhs37 from './bankhs37.json' with { type: 'json' };
import bankhs38 from './bankhs38.json' with { type: 'json' };
import bankhs39 from './bankhs39.json' with { type: 'json' };
import bankhs40 from './bankhs40.json' with { type: 'json' };
import bankhs41 from './bankhs41.json' with { type: 'json' };
import bankhs42 from './bankhs42.json' with { type: 'json' };
import bankhs43 from './bankhs43.json' with { type: 'json' };
import bankhs44 from './bankhs44.json' with { type: 'json' };
import bankhs45 from './bankhs45.json' with { type: 'json' };
import bankhs46 from './bankhs46.json' with { type: 'json' };
import bankhs47 from './bankhs47.json' with { type: 'json' };
import bankhs48 from './bankhs48.json' with { type: 'json' };
import bankhs49 from './bankhs49.json' with { type: 'json' };
import bankhs50 from './bankhs50.json' with { type: 'json' };
import bankhs51 from './bankhs51.json' with { type: 'json' };
import bankhs52 from './bankhs52.json' with { type: 'json' };
import bankhs53 from './bankhs53.json' with { type: 'json' };
import bankhs54 from './bankhs54.json' with { type: 'json' };
import bankhs55 from './bankhs55.json' with { type: 'json' };
import bankhs56 from './bankhs56.json' with { type: 'json' };
import bankhs57 from './bankhs57.json' with { type: 'json' };
import bankhs58 from './bankhs58.json' with { type: 'json' };
import bankhs59 from './bankhs59.json' with { type: 'json' };
import bankhs60 from './bankhs60.json' with { type: 'json' };
import bankhs61 from './bankhs61.json' with { type: 'json' };
import bankhs62 from './bankhs62.json' with { type: 'json' };
import bankhs63 from './bankhs63.json' with { type: 'json' };
import bankhs64 from './bankhs64.json' with { type: 'json' };
import bankhs65 from './bankhs65.json' with { type: 'json' };
import bankhs66 from './bankhs66.json' with { type: 'json' };
import bankhs67 from './bankhs67.json' with { type: 'json' };
import bankhs68 from './bankhs68.json' with { type: 'json' };
import bankhs69 from './bankhs69.json' with { type: 'json' };
import bankhs70 from './bankhs70.json' with { type: 'json' };

// 题库数组顺序决定练习目标的展示顺序，按编号从小到大排列
export const hsQuestionBanks = [bankhs1, bankhs2, bankhs3, bankhs4, bankhs5, bankhs6, bankhs7, bankhs8, bankhs9, bankhs10, bankhs11, bankhs12, bankhs13, bankhs14, bankhs15, bankhs16, bankhs17, bankhs18, bankhs19, bankhs20, bankhs21, bankhs22, bankhs23, bankhs24, bankhs25, bankhs26, bankhs27, bankhs28, bankhs29, bankhs30, bankhs31, bankhs32, bankhs33, bankhs34, bankhs35, bankhs36, bankhs37, bankhs38, bankhs39, bankhs40, bankhs41, bankhs42, bankhs43, bankhs44, bankhs45, bankhs46, bankhs47, bankhs48, bankhs49, bankhs50, bankhs51, bankhs52, bankhs53, bankhs54, bankhs55, bankhs56, bankhs57, bankhs58, bankhs59, bankhs60, bankhs61, bankhs62, bankhs63, bankhs64, bankhs65, bankhs66, bankhs67, bankhs68, bankhs69, bankhs70];
export const hsQuestionBankTaxonomy = {
  groups: bankhs1.taxonomy.groups,
  scenarioById: new Map(bankhs1.taxonomy.scenarios.map((scene) => [scene.id, scene])),
  blockById: new Map(bankhs1.taxonomy.blocks.map((block) => [block.id, block])),
};
