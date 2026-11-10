// 高中数学路由题库。只包含 HS 题库，不引入高数的 first-batch 或 bank402。
import { extendPreparedTargets } from './importedTargets.js';
import { hsQuestionBanks, hsQuestionBankTaxonomy } from './question-banks/index-hs.js';

export const preparedRouteTargets = extendPreparedTargets([], hsQuestionBanks, hsQuestionBankTaxonomy);
