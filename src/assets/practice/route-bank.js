// Original worked examples for exercising the route mechanism. These are not
// claimed to be user-approved classic mother questions or textbook quotations.
import { buildFirstBatch } from './first-batch.js';
import { extendPreparedTargets } from './importedTargets.js';
import { questionBanks, questionBankTaxonomy } from './question-banks/index.js';
const s = String.raw;
const step = (scenarioId, methodId, state, transformedState, condition) => ({ scenarioId, methodId, state, transformedState, condition });
const route = (id, summary, steps, reason, { valid = true, preferred = false, condition = '在题目给出的条件下进行。', failedStep = 0 } = {}) => ({ id, summary, steps, reason, valid, preferred, condition, ...(!valid ? { failedStep } : {}) });
const v = { op: 'var' }, c = { op: 'const' };
const op = (name, ...args) => ({ op: name, args });
const S = {
  zero: 'S.limit.0over0', inf: 'S.limit.inf_minus_inf', power: 'S.limit.one_to_inf', continuity: 'S.limit.piecewise_continuity',
  implicit: 'S.deriv.implicit_derivative', sub: 'S.indefint.first_substitution', product: 'S.indefint.by_parts_product',
  absolute: 'S.defint.piecewise_absolute', homogeneous: 'S.ode.homogeneous_first_order', bernoulli: 'S.ode.bernoulli',
};
const main = { preferred: true };
const bad = { valid: false };
function question(id, entrance, goal, body, solution, routes, structure, criterion = '在满足条件的前提下，优先减少求导或展开的次数') {
  return { format: 'route-v1', entranceScenarioId: entrance, question: body, solution, routes, structure,
    variables: ['x', ...['y', 'a', 'b'].filter((name) => new RegExp(`(?:^|[^A-Za-z])${name}(?:[^A-Za-z]|$)`).test(body))], comparisonCriterion: criterion,
    metadata: { motherId: id, trainingGoal: goal, source: { kind: 'self_authored', label: 'Mathmyth 自编已核对样题', reference: '路线题库 2026-10-11' },
      reviewStatus: 'worked_example_checked', userApprovedClassic: false, contentVersion: id === 'own.limit.sin-ratio' ? 2 : 1,
      invariants: ['保留各步骤实际适用的前提', '保持明确的入口情景与目标结论'], allowedVariations: ['调整系数后重新求解', '改变外形但保留关键结构'] } };
}

const zeroGoal = '识别相消结构，保留决定极限的主项';
const zeroQuestions = [
  question('own.limit.sin-ratio', S.zero, zeroGoal, s`求 $\displaystyle\lim_{x\to0}\frac{\sin(3x)}{x}$。`, s`$\sin(3x)\sim3x$，因此极限为 $3$。也可恒等改写为 $3\cdot\sin(3x)/(3x)$，令 $u=3x\to0$，用重要极限得 $3\times1=3$。检查 $0/0$ 与可导条件后，一次洛必达也能求得3。`, [
    route('r-equivalent', '将 sin(3x) 化为等价无穷小，再约去 x', [step(S.zero, 'M.equiv_infinitesimal', s`$\sin(3x)/x$`, s`$3x/x\to3$`, s`$x\to0$，标准无穷小在商式中作等价替换。`)], '一个标准等价式即可结束，计算短。', main),
    route('r-lhopital', '检查未定式和可导条件，再求导后取极限', [step(S.zero, 'M.lhopital', s`$\sin(3x)/x$`, s`$3\cos(3x)\to3$`, '分子分母趋于零，去心邻域可导且分母导数为1。')], '一次洛必达也能得到3。'),
    { ...route('r-important', '把分母凑成 3x，外面乘回 3，再用 sin u/u 的重要极限', [step(S.zero, 'M.important_limit', s`$\sin(3x)/x$`, s`$3\cdot\frac{\sin(3x)}{3x}\to3\times1=3$`, '令u=3x，x→0时u→0；分母乘3后，外面必须乘回3。')], '这是第一个重要极限的正确变形，与直接等价替换一样简短。'), equallyPreferred: true },
    route('r-direct', '将分子、分母分别代入 0，认为结果是 0', [step(S.zero, 'M.equiv_infinitesimal', s`$\sin(3x)/x$`, s`$0/0$ 不能作为数值结果。`, '必须比较趋零的速度，不能把0/0当作0。')], '0/0 是未定式，分母趋零时不能这样代入。', bad),
  ], op('divide', op('sin', op('multiply', c, v)), v)),
  question('own.limit.exp-cancel', S.zero, zeroGoal, s`求 $\displaystyle\lim_{x\to0}\frac{e^x-1-x}{x^2}$。`, s`$e^x=1+x+\frac{x^2}{2}+o(x^2)$，消去常数和一次项后，极限为 $\frac12$。连续两次洛必达也得到 $\frac12$。`, [
    route('r-taylor', '把指数展开到二阶，消去低阶项后比较主项', [step(S.zero, 'M.taylor_expansion', s`$(e^x-1-x)/x^2$`, s`$[x^2/2+o(x^2)]/x^2\to1/2$`, '一次项已相消，必须保留二阶项。')], '二阶展开直接保留决定答案的信息。', main),
    route('r-lhopital', '第一次求导后重新检查 0/0，再用一次洛必达', [step(S.zero, 'M.lhopital', s`$(e^x-1-x)/x^2$`, s`$(e^x-1)/(2x)$`, '第一次满足0/0条件。'), step(S.zero, 'M.lhopital', s`$(e^x-1)/(2x)$`, s`$e^x/2\to1/2$`, '第一次求导后仍为0/0，可以继续。')], '两次洛必达都满足条件，路线可行。'),
    route('r-equivalent', '将 e^x−1 直接替换成 x，再消去分子', [step(S.zero, 'M.equiv_infinitesimal', s`$e^x-1-x$`, '直接替换会丢掉二阶余项。', '等价无穷小不能在相消的减法中丢掉关键余项。')], '相消之后答案由二阶项决定，只保留一次等价式会得到错误的0。', bad),
  ], op('divide', op('subtract', op('exp', v), c, v), op('power', v, c))),
  question('own.limit.log-sin', S.zero, zeroGoal, s`求 $\displaystyle\lim_{x\to0}\frac{\ln(1+x)-\sin x}{x^2}$。`, s`$\ln(1+x)=x-\frac{x^2}{2}+o(x^2)$，$\sin x=x+o(x^2)$，所以极限为 $-\frac12$。两次洛必达给出 $\frac{-1/(1+x)^2+\sin x}{2}\to-\frac12$。`, [
    route('r-taylor', '分别展开对数和正弦，消去一次项后比较二阶项', [step(S.zero, 'M.taylor_expansion', s`$[\ln(1+x)-\sin x]/x^2$`, s`$[-x^2/2+o(x^2)]/x^2\to-1/2$`, '去心邻域内1+x>0，保留二阶信息。')], '一次项相消，二阶项决定结果。', main),
    route('r-lhopital', '求导一次，再检查未定式，继续求导取极限', [step(S.zero, 'M.lhopital', s`$[\ln(1+x)-\sin x]/x^2$`, s`$[1/(1+x)-\cos x]/(2x)$`, '第一步为0/0且可导。'), step(S.zero, 'M.lhopital', s`$[1/(1+x)-\cos x]/(2x)$`, s`$[-1/(1+x)^2+\sin x]/2\to-1/2$`, '导后仍为0/0，第二次也满足条件。')], '连续求导有效，第二次导数的极限存在。'),
    route('r-equivalent', '把对数和正弦都换成 x，直接宣布极限为 0', [step(S.zero, 'M.equiv_infinitesimal', s`$\ln(1+x)-\sin x$`, '两个一次等价项相消，留下的余项未被保留。', '相消减法必须保留更高阶项。')], '把两个函数同时换成x，恰好丢掉决定答案的二阶差。', bad),
  ], op('divide', op('subtract', op('log', op('add', c, v)), op('sin', v)), op('power', v, c))),
];

const infGoal = '先消除无穷大的相消，再处理剩余商式';
const infQuestions = [
  question('own.limit.root-minus', S.inf, infGoal, s`求 $\displaystyle\lim_{x\to+\infty}(\sqrt{x^2+x}-x)$。`, s`有理化得到 $\frac{x}{\sqrt{x^2+x}+x}=\frac1{\sqrt{1+1/x}+1}\to\frac12$。`, [
    route('r-rational', '先乘共轭化为商，再同除最高次幂', [step(S.inf, 'M.rationalization', s`$\sqrt{x^2+x}-x$`, s`$x/(\sqrt{x^2+x}+x)$`, '共轭和为正，不为0。'), step('S.limit.inf_over_inf', 'M.divide_highest_power', s`$x/(\sqrt{x^2+x}+x)$`, s`$1/(\sqrt{1+1/x}+1)\to1/2$`, 'x趋于正无穷，可以提取x。')], '共轭消去相消，再除以x即可。', main),
    route('r-derivative', '先有理化为 ∞/∞，再用洛必达求极限', [step(S.inf, 'M.rationalization', s`$\sqrt{x^2+x}-x$`, s`$x/(\sqrt{x^2+x}+x)$`, '共轭和不为0。'), step('S.limit.inf_over_inf', 'M.lhopital', s`$x/(\sqrt{x^2+x}+x)$`, s`$1/[(2x+1)/(2\sqrt{x^2+x})+1]\to1/2$`, '分子分母都趋于正无穷且满足可导条件。')], '可行，但求导比提取最高次幂更费计算。'),
    route('r-drop', '把根式直接换成 x，相减得到 0', [step(S.inf, 'M.equiv_infinitesimal', s`$\sqrt{x^2+x}-x$`, '直接舍去差值所需的次主项。', '相减结构中不能仅因两项比值趋于1就把差换成0。')], '两个量同阶不意味着它们的差趋于0；常数差被丢掉了。', bad),
  ], op('subtract', op('sqrt', op('add', op('power', v, c), v)), v)),
  question('own.limit.two-roots', S.inf, infGoal, s`求 $\displaystyle\lim_{x\to+\infty}(\sqrt{x^2+2x}-\sqrt{x^2-x})$。`, s`有理化后 $\frac{3x}{\sqrt{x^2+2x}+\sqrt{x^2-x}}=\frac3{\sqrt{1+2/x}+\sqrt{1-1/x}}\to\frac32$。`, [
    route('r-rational', '用共轭消去根式差，再提取分母中的 x', [step(S.inf, 'M.rationalization', '两根式之差', s`$3x/(\sqrt{x^2+2x}+\sqrt{x^2-x})$`, 'x足够大时两个根式有定义且共轭和为正。'), step('S.limit.inf_over_inf', 'M.divide_highest_power', '有理化后的商', s`$3/(\sqrt{1+2/x}+\sqrt{1-1/x})\to3/2$`, '趋于正无穷，提取根号内x²所得为x。')], '有理化后主项清楚，直接得到3/2。', main),
    route('r-lhopital', '先有理化，再对得到的商使用洛必达', [step(S.inf, 'M.rationalization', '两根式之差', s`$3x/(\sqrt{x^2+2x}+\sqrt{x^2-x})$`, '共轭和不为0。'), step('S.limit.inf_over_inf', 'M.lhopital', '有理化的∞/∞商', '分子导数为3，分母导数趋于2，故极限为3/2。', '导后分母趋于2且原分子分母均趋于无穷。')], '路线有效，但两处根式求导比提取x更长。'),
    route('r-zero', '把两个根式都视为 x，直接相减', [step(S.inf, 'M.equiv_infinitesimal', '两根式之差', '舍去了两个根式的不同次主项。', '相消时必须保留差的有效阶。')], '两个根式的次主项不同，相减得到0会遗漏3/2。', bad),
  ], op('subtract', op('sqrt', op('add', op('power', v, c), op('multiply', c, v))), op('sqrt', op('subtract', op('power', v, c), v)))),
  question('own.limit.rational-difference', S.inf, infGoal, s`求 $\displaystyle\lim_{x\to+\infty}\left(\frac{x^2+x}{x+1}-\frac{x^2-x}{x+2}\right)$。`, s`第一项约分为 $x$，再通分得 $x-\frac{x(x-1)}{x+2}=\frac{3x}{x+2}$。同除 $x$，极限为 $3$；化商后也可用一次洛必达。`, [
    route('r-factor', '因式分解约去公共因子，再通分并比较商式的主项', [step(S.inf, 'M.factor_cancel', '两个趋于无穷的有理式相减', s`$x-\frac{x(x-1)}{x+2}=\frac{3x}{x+2}$`, '第一项的x+1在附近非零，因式分解后可约去；通分保持恒等。'), step('S.limit.inf_over_inf', 'M.divide_highest_power', s`$3x/(x+2)$`, s`$3/(1+2/x)\to3$`, 'x趋于正无穷且不为零，可分子分母同除x。')], '约分先消掉一个分母，化商后直接比较主项。', main),
    route('r-lhopital', '先约分和通分，确认 ∞/∞ 后再用洛必达', [step(S.inf, 'M.factor_cancel', '先消去第一项的公共因子', s`$x-\frac{x(x-1)}{x+2}=\frac{3x}{x+2}$`, '去心邻域内两个分母均非零。'), step('S.limit.inf_over_inf', 'M.lhopital', s`$3x/(x+2)$`, s`$3/1\to3$`, '分子分母都趋于正无穷，可导且分母导数为1。')], '一次求导也可行，直接除以x则不用求导。'),
    route('r-subtract', '把两个有理式都换成最高次主项 x，再相减得到 0', [step(S.inf, 'M.factor_cancel', '两个同阶有理式之差', '只保留各自最高次项，会丢掉差的常数项。', '差式不能只凭各部分与x的比值趋于1就忽略次主项。')], '两项同阶并不意味着差趋于0；实际剩下的常数为3。', bad),
  ], op('subtract', op('divide', op('add', op('power', v, c), v), op('add', v, c)), op('divide', op('subtract', op('power', v, c), v), op('add', v, c)))),
];

const powerGoal = '幂指未定式先取对数，再识别新的极限情景';
const powerQuestions = [
  question('own.limit.power-linear', S.power, powerGoal, s`求 $\displaystyle\lim_{x\to0}(1+2x)^{1/x}$。`, s`令 $L=(1+2x)^{1/x}$，则 $\ln L=\ln(1+2x)/x\to2$，所以 $L\to e^2$。也可令 $t=2x$ 后用重要极限。`, [
    route('r-important', '令 t=2x，化成重要极限的平方', [step(S.power, 'M.important_limit', s`$(1+2x)^{1/x}$`, s`$[(1+t)^{1/t}]^2\to e^2$`, 'x足够接近0时底数为正，重要极限两侧均成立。')], '标准结构可直接识别，变元后只需一个重要极限。', main),
    route('r-log', '先取对数，处理 0/0 极限，最后取指数', [step(S.power, 'M.log_transform', '正底数的1^∞形式', s`$\ln L=\ln(1+2x)/x$`, '邻域内1+2x>0。'), step(S.zero, 'M.equiv_infinitesimal', s`$\ln(1+2x)/x$`, s`$2x/x\to2$，再取指数得到 $e^2$。`, '对数在商式中可用标准等价式。')], '取对数后，原题变为0/0商式，路线同样成立。'),
    route('r-one', '底数趋于 1，所以直接得到 1', [step(S.power, 'M.important_limit', '底数趋于1而指数无界', '不能将底数极限与变动指数直接分开。', '1^∞是未定式，需联立考虑底数接近1的速度。')], '指数同时无界，连续代入的条件不成立。', bad),
  ], op('power', op('add', c, op('multiply', c, v)), op('divide', c, v))),
  question('own.limit.power-cos', S.power, powerGoal, s`求 $\displaystyle\lim_{x\to0}(\cos x)^{1/x^2}$。`, s`取对数得到 $\ln(\cos x)/x^2\to-\frac12$，原极限为 $e^{-1/2}$。因为 $\cos x=1-x^2/2+o(x^2)$，取对数后保留二阶项。`, [
    route('r-log-taylor', '先取对数，再展开到二阶，最后还原指数', [step(S.power, 'M.log_transform', s`$(\cos x)^{1/x^2}$`, s`$\ln(\cos x)/x^2$`, '0附近cosx>0，允许取实对数。'), step(S.zero, 'M.taylor_expansion', '对数后的0/0商', s`$[-x^2/2+o(x^2)]/x^2\to-1/2$，原极限 $e^{-1/2}$。`, '二阶项才是第一个非零项。')], '二阶结构明确，可减少重复求导。', main),
    route('r-log-lhopital', '取对数，连续两次洛必达，再取指数', [step(S.power, 'M.log_transform', '正底数幂指式', s`$\ln(\cos x)/x^2$`, 'cosx>0。'), step(S.zero, 'M.lhopital', '0/0商', s`$-\tan x/(2x)$`, '第一次求导后仍为0/0。'), step(S.zero, 'M.lhopital', s`$-\tan x/(2x)$`, s`$-\sec^2x/2\to-1/2$，再取指数。`, '第二次导数比极限存在。')], '有效，但需要连续两次求导。'),
    route('r-one', '先把 cos x 代成 1，然后指数是多少都得 1', [step(S.power, 'M.important_limit', '1^∞未定式', '忽略了cosx偏离1的二阶速度。', '无界指数下不能如此代入底数。')], '底数的二阶偏离与1/x²共同决定结果，直接代成1会出错。', bad),
  ], op('power', op('cos', v), op('divide', c, op('power', v, c)))),
  question('own.limit.power-quad', S.power, powerGoal, s`求 $\displaystyle\lim_{x\to0}(1+x+x^2)^{1/x}$。`, s`取对数后 $\frac{\ln(1+x+x^2)}x\sim\frac{x+x^2}x\to1$，原极限 $e$。或令 $u=x+x^2$，写成 $[(1+u)^{1/u}]^{u/x}\to e$。`, [
    route('r-log', '取对数，把对数商化成等价无穷小，再取指数', [step(S.power, 'M.log_transform', '正底数1^∞形式', s`$\ln(1+x+x^2)/x$`, '0附近底数为正。'), step(S.zero, 'M.equiv_infinitesimal', '取对数后的0/0商', s`$(x+x^2)/x\to1$，取指数得到 $e$。`, 'u=x+x²趋于0，ln(1+u)~u。')], '对数转化后两个因子即可比较。', main),
    route('r-important', '令 u=x+x²，拆成重要极限与趋于 1 的指数', [step(S.power, 'M.important_limit', s`$(1+x+x^2)^{1/x}$`, s`$[(1+u)^{1/u}]^{u/x}\to e^1$`, 'u趋于0，u/x=1+x趋于1，底数为正。')], '重要极限也成立，但需要额外引入一个整体变量。'),
    route('r-ignore', '由于底数趋于 1，直接代入得 1', [step(S.power, 'M.important_limit', '底数与指数同时变化', '错误地忽略无界指数。', '1^∞的联合极限不能拆成这种代入。')], '底数偏离1的一次速度与无界指数匹配，实际结果为e。', bad),
  ], op('power', op('add', c, v, op('power', v, c)), op('divide', c, v))),
];

const continuityGoal = '连续性同时核对左右极限与函数值';
function continuityQuestion(id, body, solution, left, right, answer, structure) {
  return question(id, S.continuity, continuityGoal, body, solution, [
    route('r-sides', '分别求左右极限，再与分界点函数值比较', [step(S.continuity, 'M.one_sided_limit', '分段函数的分界点', '将左右表达式分别放入对应的单侧极限，出现两个待计算的0/0商。', '连续性要求两个单侧极限及函数值都相等。'), step(S.zero, 'M.equiv_infinitesimal', '单侧极限中出现的0/0商', s`标准等价式给出左极限 ${left}、右极限 ${right}；与 $f(0)$ 比较后得到：${answer}`, '各标准式在对应单侧去心邻域适用。')], '三个量全部检查，既给出参数条件也排除跳跃。', main),
    route('r-derivative', '先分别检查单侧商式，再用洛必达求两侧极限并比较函数值', [step(S.continuity, 'M.one_sided_limit', '分界点左右两条表达式', '分别取对应单侧极限。', '左右表达式各自有定义。'), step(S.zero, 'M.lhopital', '左右相应的0/0商', s`逐侧求导后得到 ${left} 与 ${right}，再比较 $f(0)$。`, '每个商都在其单侧邻域满足洛必达条件。')], '可行，但标准单侧等价式通常更直接。'),
    route('r-value', '只看 f(0) 是否存在，存在就判连续', [step(S.continuity, 'M.one_sided_limit', '分界点函数值已给定', '函数值存在仍不能保证左右极限与其相等。', '函数值存在只是连续性的必要条件之一。')], '漏了左右极限与函数值的比较，不能判定连续。', bad),
  ], structure, '在完整核对连续性条件的前提下，优先使用标准等价式减少求导');
}
const continuityQuestions = [
  continuityQuestion('own.continuity.sin-parameter', s`设 $f(x)=\begin{cases}\sin x/x,&x<0,\\a,&x=0,\\\ln(1+x)/x,&x>0.\end{cases}$ 问 $a$ 取何值时 $f$ 在 $0$ 连续？`, s`左右极限都为 $1$，所以且仅当 $a=1$ 时连续。`, '$1$', '$1$', '$a=1$', op('piecewise', op('divide', op('sin', v), v), c, op('divide', op('log', op('add', c, v)), v))),
  continuityQuestion('own.continuity.jump', s`设 $f(x)=\begin{cases}\sin(2x)/x,&x<0,\\a,&x=0,\\(\sqrt{1+x}-1)/x,&x>0.\end{cases}$ 是否存在 $a$ 使 $f$ 在 $0$ 连续？`, s`左极限为 $2$，右极限为 $\frac12$，两个单侧极限不相等。任何 $a$ 都不能使其连续。`, '$2$', '$1/2$', '不存在这样的a', op('piecewise', op('divide', op('sin', op('multiply', c, v)), v), c, op('divide', op('subtract', op('sqrt', op('add', c, v)), c), v))),
  continuityQuestion('own.continuity.two-parameters', s`设 $f(x)=\begin{cases}(e^{2x}-1)/x,&x<0,\\b,&x=0,\\a\sin x/x,&x>0.\end{cases}$ 求使 $f$ 在 $0$ 连续的 $a,b$。`, s`左极限为 $2$，右极限为 $a$。连续性要求 $2=a=b$，所以 $a=b=2$。`, '$2$', '$a$', '$a=b=2$', op('piecewise', op('divide', op('subtract', op('exp', op('multiply', c, v)), c), v), c, op('multiply', c, op('divide', op('sin', v), v)))),
];

const implicitGoal = '把未知函数作为复合函数求导，再整理目标导数';
const implicitQuestions = [
  question('own.deriv.circle', S.implicit, implicitGoal, s`曲线 $x^2+y^2=1$ 上，求满足 $y\ne0$ 的点处的 $\frac{dy}{dx}$。`, s`两侧对 $x$ 求导：$2x+2yy'=0$，所以 $y'=-x/y$。局部也可写成 $y=\pm\sqrt{1-x^2}$ 并求导。`, [
    route('r-implicit', '两侧求导，把 y 当作 x 的函数，再解出 y′', [step(S.implicit, 'M.implicit_differentiation', s`$x^2+y(x)^2=1$`, s`$2x+2yy'=0\Rightarrow y'=-x/y$`, 'y≠0保证可解出局部导数。')], '保留隐式关系即可一步整理导数。', main),
    route('r-explicit', '先在局部选择平方根分支，再用链式法则求导', [step(S.implicit, 'M.chain_rule', s`$y=\pm\sqrt{1-x^2}$`, s`$y'=-x/y$`, '局部选定与点一致的正负分支，y≠0。')], '局部可行，但必须额外处理分支。'),
    route('r-constant', '把 y² 看作常数，两侧求导只保留 2x', [step(S.implicit, 'M.implicit_differentiation', s`$x^2+y(x)^2=1$`, '忽略y随x变化导致漏掉2yy′。', 'y是待求的函数，不是常数。')], 'y²的导数是2yy′，漏掉它不能得到正确导数。', bad),
  ], op('implicit', op('add', op('power', v, c), op('power', v, c)), c), '优先不消元、不额外分支，直接求导后整理'),
  question('own.deriv.explicit-implicit', S.implicit, implicitGoal, s`由 $y+e^y=x$ 确定 $y=y(x)$，求 $y'$。`, s`$y'+e^y y'=1$，所以 $y'=\frac1{1+e^y}$。把 $x=g(y)$ 看作反函数关系也可得到同一结果。`, [
    route('r-implicit', '对隐式关系求导，提出 y′ 并解出', [step(S.implicit, 'M.implicit_differentiation', s`$y+e^y=x$`, s`$(1+e^y)y'=1\Rightarrow y'=1/(1+e^y)$`, '1+e^y始终为正，隐函数局部可导。')], '复合函数中的y′可共同提出。', main),
    route('r-chain', '对复合关系 g(y(x))=x 用链式法则，再整理', [step(S.implicit, 'M.chain_rule', s`$g(y(x))=x,\ g(t)=t+e^t$`, s`$g'(y)y'=1\Rightarrow y'=1/(1+e^y)$`, 'g′=1+e^y>0，因此分母不为0。')], '链式法则给出等价且正确的推导。'),
    route('r-no-chain', '把 e^y 的导数写成 e^y，直接令 y′=1−e^y', [step(S.implicit, 'M.implicit_differentiation', s`$y+e^y=x$`, '漏掉指数复合函数的y′因子。', 'e^y对x求导必须乘y′。')], 'e^y的导数是e^y y′，漏掉内层导数会改变方程。', bad),
  ], op('implicit', op('add', v, op('exp', v)), v), '优先直接对原关系求导并收集 y′，减少额外记号'),
  question('own.deriv.sin-implicit', S.implicit, implicitGoal, s`在 $1+\cos y\ne0$ 的点，关系 $y+\sin y=x^2$ 所确定函数的导数是什么？`, s`对 $x$ 求导：$(1+\cos y)y'=2x$，所以 $y'=\frac{2x}{1+\cos y}$。分母非零正是可整理出局部导数的条件。`, [
    route('r-implicit', '逐项对 x 求导，收集 y′，检查系数非零后相除', [step(S.implicit, 'M.implicit_differentiation', s`$y+\sin y=x^2$`, s`$(1+\cos y)y'=2x\Rightarrow y'=2x/(1+\cos y)$`, '题设1+cosy≠0。')], '链式求导与非零条件都得到保留。', main),
    route('r-chain', '将左边视为整体 g(y)，先用链式法则再整理', [step(S.implicit, 'M.chain_rule', s`$g(y(x))=x^2,\ g(t)=t+\sin t$`, s`$g'(y)y'=2x$，得到同一导数。`, 'g′(y)=1+cosy非零。')], '整体链式法则也正确，额外记号并不必要。'),
    route('r-no-chain', '把 sin y 对 x 的导数直接写成 cos y', [step(S.implicit, 'M.implicit_differentiation', '未知函数进入三角函数', '误得到y′+cosy=2x。', 'sin(y(x))的导数应为cosy乘y′。')], '内层函数的导数没有乘上，不能得到正确导数。', bad),
  ], op('implicit', op('add', v, op('sin', v)), op('power', v, c)), '优先直接对原关系求导并收集 y′，减少额外记号'),
];

const subGoal = '识别凑微分，换元后再判断新积分结构';
const subQuestions = [
  question('own.integral.simple-sub', S.sub, subGoal, s`计算 $\displaystyle\int\frac{2x}{1+x^2}\,dx$。`, s`令 $u=1+x^2$，$du=2x\,dx$，得到 $\int du/u=\ln(1+x^2)+C$。`, [
    route('r-diff', '把 2x dx 凑成 d(1+x²)，再套对数积分公式', [step(S.sub, 'M.first_substitution', s`$\int2x/(1+x^2)\,dx$`, s`$\int d(1+x^2)/(1+x^2)=\ln(1+x^2)+C$`, '1+x²>0，导数因子恰为2x。')], '微分因子匹配，无需复杂变换。', main),
    route('r-variable', '显式令 u=1+x²，再对新的基本积分求原函数', [step(S.sub, 'M.integration_by_substitution', '内层函数1+x²与导数2x同时出现', s`$\int du/u$`, 'du=2x dx，换元因子完整。'), step('S.indefint.basic_formula', 'M.basic_integral_formula', s`$\int du/u$`, s`$\ln|u|+C=\ln(1+x^2)+C$`, 'u=1+x²>0。')], '显式换元同样可行，只是记号略多。'),
    route('r-miss', '令 u=1+x²，但把 dx 直接替成 du', [step(S.sub, 'M.integration_by_substitution', '原积分的换元', '误把2x dx当成2x du。', 'du=2x dx，必须同时变换微分因子。')], '忽略雅可比因子会使新积分与原积分不相等。', bad),
  ], op('integral', op('divide', op('multiply', c, v), op('add', c, op('power', v, c)))), '优先识别直接凑微分，减少多余换元记号'),
  question('own.integral.log-sub', S.sub, subGoal, s`在 $x>0$ 上计算 $\displaystyle\int\frac{\ln x}{x}\,dx$。`, s`令 $u=\ln x$，则 $du=dx/x$，原式变为 $\int u\,du=\frac12(\ln x)^2+C$。`, [
    route('r-diff', '把 dx/x 凑为 d(ln x)，再对 ln x 的一次幂积分', [step(S.sub, 'M.first_substitution', s`$\int(\ln x)/x\,dx$`, s`$\int\ln x\,d(\ln x)=\tfrac12(\ln x)^2+C$`, 'x>0，d(lnx)=dx/x。')], '导数因子已经出现，直接凑微分。', main),
    route('r-variable', '令 u=ln x，转成幂函数积分再回代', [step(S.sub, 'M.integration_by_substitution', '对数与其导数的乘积', s`$\int u\,du$`, 'du=dx/x。'), step('S.indefint.basic_formula', 'M.basic_integral_formula', s`$\int u\,du$`, s`$u^2/2+C=(\ln x)^2/2+C$`, '幂函数积分公式适用。')], '换元后是新的基本公式情景。'),
    route('r-product', '把 ln x 的原函数与 1/x 的原函数相乘', [step(S.sub, 'M.first_substitution', '两个函数的乘积', '原函数的乘积并不等于乘积的原函数。', '积分没有这种乘法分配规则。')], '积分不能把两项各自积分后直接相乘。', bad),
  ], op('integral', op('divide', op('log', v), v)), '优先直接凑微分，减少变换次数'),
  question('own.integral.sub-parts', S.sub, subGoal, s`在 $x>0$ 上计算 $\displaystyle\int x^3 e^{x^2}\,dx$。`, s`令 $u=x^2$，$du=2x\,dx$，原式为 $\frac12\int u e^u\,du$。分部积分得 $\frac12e^{x^2}(x^2-1)+C$。`, [
    route('r-sub-parts', '令 u=x² 化去复合结构，再对 u e^u 分部积分', [step(S.sub, 'M.integration_by_substitution', s`$\int x^3 e^{x^2}\,dx$`, s`$\frac12\int u e^u\,du$`, 'x³dx=x²(xdx)，du=2x dx。'), step(S.product, 'M.integration_by_parts', s`$\int u e^u\,du$`, s`$e^u(u-1)$，回代为 $\frac12e^{x^2}(x^2-1)+C$。`, '多项式与指数的乘积，取u为多项式因子。')], '换元产生乘积型新情景，再分部即可。', main),
    route('r-parts', '写成 (x²/2)d(e^{x²})，直接分部，再凑微分', [step(S.sub, 'M.first_substitution', s`$x^3e^{x^2}dx$`, s`$\frac12x^2d(e^{x^2})$`, 'd(e^{x²})=2xe^{x²}dx。'), step(S.product, 'M.integration_by_parts', s`$\frac12\int x^2d(e^{x^2})$`, s`$\frac12x^2e^{x^2}-\int xe^{x^2}dx$`, '取x²为需求导的因子。'), step(S.sub, 'M.first_substitution', s`$\int xe^{x^2}dx$`, s`$\frac12e^{x^2}$，最终同主路线。`, '再利用指数内层的导数。')], '可行，原变量下分部也会回到凑微分。'),
    route('r-stop', '换元为 u=x² 后，把 ∫u e^u du 当成 u e^u', [step(S.sub, 'M.integration_by_substitution', '先令u=x²', s`$\frac12\int ue^u du$`, '第一次换元正确。'), step(S.product, 'M.integration_by_parts', s`$\int ue^u du$`, '直接去掉积分号，遗漏分部积分的减项。', 'ue^u的导数是(u+1)e^u，不是ue^u。')], '换元后仍需处理乘积，直接去掉积分号遗漏−e^u。', { ...bad, failedStep: 1 }),
  ], op('integral', op('multiply', op('power', v, c), op('exp', op('power', v, c)))), '优先把复合结构换为一个变量，再处理乘积'),
];

const productGoal = '分部积分降低复杂度，及时识别剩余积分';
const productQuestions = [
  question('own.integral.parts-linear', S.product, productGoal, s`计算 $\displaystyle\int x e^x\,dx$。`, s`取 $u=x,dv=e^x dx$，分部得到 $xe^x-\int e^x dx=e^x(x-1)+C$。`, [
    route('r-parts', '把 x 作为求导因子、e^x dx 作为积分因子，再处理剩余基本积分', [step(S.product, 'M.integration_by_parts', s`$\int xe^x dx$`, s`$xe^x-\int e^x dx$`, 'x求导后降为常数，指数积分不变复杂。'), step('S.indefint.basic_formula', 'M.basic_integral_formula', s`$\int e^x dx$`, s`$e^x(x-1)+C$`, '指数的基本积分公式。')], '多项式求导降低次数，剩余项直接结束。', main),
    route('r-reduction', '用多项式乘指数的递推关系降一次幂', [step(S.product, 'M.reduction_formula', s`$I_1=\int xe^x dx$`, s`$I_1=xe^x-I_0,\ I_0=e^x$`, '递推关系本身由分部积分推得。')], '递推写法正确，但一阶题直接分部更简洁。'),
    route('r-product', '把 ∫x dx 与 ∫e^x dx 相乘', [step(S.product, 'M.integration_by_parts', s`$\int xe^x dx$`, '误把乘积积分变为原函数乘积。', '必须保留分部公式中的减项。')], '积分不满足乘积原函数相乘的规则，求导即可验证错误。', bad),
  ], op('integral', op('multiply', v, op('exp', v))), '优先选择立即降次的分部，避免额外递推记号'),
  question('own.integral.parts-quad', S.product, productGoal, s`计算 $\displaystyle\int x^2 e^x\,dx$。`, s`连续两次分部：$x^2e^x-2\int xe^x dx=e^x(x^2-2x+2)+C$。`, [
    route('r-parts', '连续对多项式因子求导，分部两次后用基本积分', [step(S.product, 'M.integration_by_parts', s`$\int x^2e^x dx$`, s`$x^2e^x-2\int xe^x dx$`, 'x²求导降次。'), step(S.product, 'M.integration_by_parts', s`$\int xe^x dx$`, s`$xe^x-e^x$，合并得到 $e^x(x^2-2x+2)+C$。`, '再次降次即可终止。')], '每次都降一次幂，路线可明确终止。', main),
    route('r-reduction', '按 I₂=x²e^x−2I₁ 递推，再代入 I₁', [step(S.product, 'M.reduction_formula', '多项式乘指数积分', s`$I_2=x^2e^x-2I_1$，$I_1=e^x(x-1)$。`, '递推关系由分部积分支持，保留系数2。')], '递推可行，适合一般n次题；本题直接分部更直观。'),
    route('r-reverse', '一直把 e^x 作为求导因子、x² 作为积分因子，希望多项式降次', [step(S.product, 'M.integration_by_parts', s`$\int x^2e^x dx$`, s`$x^3e^x/3-\frac13\int x^3e^x dx$`, '反向分部会升高多项式次数。')], '每次多项式次数都升高，所声称的“逐步降次直到结束”不会发生。', bad),
  ], op('integral', op('multiply', op('power', v, c), op('exp', v))), '优先使多项式次数下降，并在有限步内结束'),
  question('own.integral.parts-trig', S.product, productGoal, s`计算 $\displaystyle\int x\cos x\,dx$。`, s`分部得 $x\sin x-\int\sin x dx=x\sin x+\cos x+C$。`, [
    route('r-parts', '令多项式因子求导、余弦因子积分，再处理剩下的正弦积分', [step(S.product, 'M.integration_by_parts', s`$\int x\cos x dx$`, s`$x\sin x-\int\sin x dx$`, 'x求导变为1，cosx易积分。'), step('S.indefint.basic_formula', 'M.basic_integral_formula', s`$-\int\sin x dx$`, s`$x\sin x+\cos x+C$`, '正弦原函数为−cosx，保留外部负号。')], '一次降次后基本公式即可完成。', main),
    route('r-reduction', '把它视为多项式乘三角函数的递推，降一次幂', [step(S.product, 'M.reduction_formula', '一次多项式乘余弦', s`$I_1=x\sin x-\int\sin x dx$，最终 $x\sin x+\cos x+C$。`, '递推的分部公式保留三角函数符号。')], '递推也能做通，但这题无需引入一般n。'),
    route('r-sign', '分部后把 −∫sin x dx 写成 −cos x', [step(S.product, 'M.integration_by_parts', s`$x\sin x-\int\sin x dx$`, s`$x\sin x-\cos x$ 不是原函数。`, 'sinx的原函数为−cosx，外部负号要再次相乘。')], '负负相乘后应为+cosx，错误路线的导数多出2sinx。', bad),
  ], op('integral', op('multiply', v, op('cos', v))), '优先直接分部一次，不引入一般递推'),
];

const absoluteGoal = '先辨认符号变化并分段，再计算定积分';
const absoluteQuestions = [
  question('own.defint.absolute-linear', S.absolute, absoluteGoal, s`计算 $\displaystyle\int_{-1}^{1}|x|\,dx$。`, s`在0处分段：$\int_{-1}^0(-x)dx+\int_0^1x dx=1$。也可利用偶函数对称性化为 $2\int_0^1x dx$。`, [
    route('r-symmetry', '利用 |x| 为偶函数，化为正半区间两倍后积分', [step(S.absolute, 'M.symmetry', s`$\int_{-1}^1|x|dx$`, s`$2\int_0^1x dx$`, '对称区间且被积函数为偶函数。'), step('S.defint.newton_leibniz_calc', 'M.newton_leibniz', s`$2\int_0^1x dx$`, '$1$', '分段后积分函数连续，原函数为x²/2。')], '对称性省去一半区间的计算。', main),
    route('r-split', '在零点处分成两段，分别去绝对值再相加', [step(S.absolute, 'M.newton_leibniz', 'x在0处变号', s`$\int_{-1}^0(-x)dx+\int_0^1x dx=1$`, '每段分别使用正确的表达式。')], '逐段计算同样正确，只是重复一段。'),
    route('r-odd', '把 |x| 当成奇函数，利用对称区间得到 0', [step(S.absolute, 'M.symmetry', '对称区间上的|x|', '误判奇偶性而得到0。', '|−x|=|x|，不是奇函数。')], '绝对值改变奇偶性，|x|是偶函数，积分不会抵消。', bad),
  ], op('definite_integral', op('abs', v), c, c), '优先利用合法的对称性减少重复计算'),
  question('own.defint.absolute-shift', S.absolute, absoluteGoal, s`计算 $\displaystyle\int_0^3|x-1|\,dx$。`, s`在1处分段：$\int_0^1(1-x)dx+\int_1^3(x-1)dx=\frac12+2=\frac52$。换元u=x−1后也需在u=0处分段。`, [
    route('r-split', '先定位变号点 x=1，再分段去绝对值计算', [step(S.absolute, 'M.newton_leibniz', 'x−1在区间内变号', s`$\int_0^1(1-x)dx+\int_1^3(x-1)dx=5/2$`, '必须分别使用各段符号。')], '直接在原变量处分段即可。', main),
    route('r-shift', '令 u=x−1 并同步改变上下限，再在 0 分段积分', [step(S.absolute, 'M.first_substitution', s`$\int_0^3|x-1|dx$`, s`$\int_{-1}^2|u|du$`, '上下限随变量一起换成−1与2。'), step(S.absolute, 'M.newton_leibniz', s`$\int_{-1}^2|u|du$`, s`$\int_{-1}^0(-u)du+\int_0^2u du=5/2$`, '新区间不对称，仍需分段。')], '换元后可行，但没有减少分段数。'),
    route('r-noabs', '直接删掉绝对值，把 x−1 在整个区间积分', [step(S.absolute, 'M.newton_leibniz', '含绝对值且有变号点', s`$\int_0^3(x-1)dx$ 并非原题。`, '在[0,1)内x−1为负，不能统一删去绝对值。')], '负区间表达式写错了，积分值会改变。', bad),
  ], op('definite_integral', op('abs', op('subtract', v, c)), c, c), '优先在原变量中完成分段，减少额外换元'),
  question('own.defint.absolute-polynomial', S.absolute, absoluteGoal, s`计算 $\displaystyle\int_{-1}^{1}|x^2-\tfrac14|\,dx$。`, s`被积函数为偶函数，在正半区间的 $1/2$ 处分段。$2[\int_0^{1/2}(1/4-x^2)dx+\int_{1/2}^1(x^2-1/4)dx]=\frac12$。`, [
    route('r-sym-split', '先用偶函数对称性，再在正半区间的变号点分段', [step(S.absolute, 'M.symmetry', '偶函数且积分区间对称', s`$2\int_0^1|x^2-1/4|dx$`, 'x²−1/4及其绝对值均为偶函数。'), step(S.absolute, 'M.newton_leibniz', '正半区间内x=1/2变号', s`$2[\int_0^{1/2}(1/4-x^2)dx+\int_{1/2}^1(x^2-1/4)dx]=1/2$`, '0到1/2为负，1/2到1为正。')], '把三个原区间减少为正半区间的两段。', main),
    route('r-split-all', '求出两个变号点，在整个区间分三段积分', [step(S.absolute, 'M.newton_leibniz', '零点为±1/2', s`$\int_{-1}^{-1/2}(x^2-1/4)dx+\int_{-1/2}^{1/2}(1/4-x^2)dx+\int_{1/2}^1(x^2-1/4)dx=1/2$`, '三段表达式符号分别正确。')], '正确，但对称的两端会重复计算。'),
    route('r-even-only', '因为它是偶函数，直接将整个积分判为 0', [step(S.absolute, 'M.symmetry', '偶函数的对称积分', '把偶函数与奇函数的积分规则混淆。', '只有可积奇函数在对称区间积分为0。')], '偶函数通常取正半区间积分的两倍，不能判为0。', bad),
  ], op('definite_integral', op('abs', op('subtract', op('power', v, c), c)), c, c), '优先利用对称性减少分段计算次数'),
];

const homogeneousGoal = '齐次换元产生可分离新情景，保留定义域与特解';
const homogeneousQuestions = [
  question('own.ode.homogeneous-linear', S.homogeneous, homogeneousGoal, s`在 $x>0$ 上解 $y'=y/x+1$。`, s`令 $u=y/x$，则 $y'=u+xu'$，所以 $xu'=1$，积分得 $u=\ln x+C$，$y=x(\ln x+C)$。也可视为一阶线性方程。`, [
    route('r-homogeneous', '令 u=y/x 消去齐次组合，再分离变量积分并回代', [step(S.homogeneous, 'M.homogeneous_equation_first_order', s`$y'=y/x+1$`, s`$xu'=1$`, 'x>0，y=xu且y′=u+xu′。'), step('S.ode.separable', 'M.separation_of_variables', s`$u'=1/x$`, s`$u=\ln x+C$，回代 $y=x(\ln x+C)$。`, '可直接对1/x积分。')], '齐次换元马上得到最简单的可分离方程。', main),
    route('r-linear', '齐次换元后，把新方程作为一阶线性方程求解，再回代', [step(S.homogeneous, 'M.homogeneous_equation_first_order', s`$y'=y/x+1$`, s`$u'+0u=1/x$`, '实际令u=y/x，并用y′=u+xu′消去u项。'), step('S.ode.linear_first_order', 'M.constant_variation', s`$u'+0u=1/x$`, s`$u=\ln x+C$，回代 $y=x(\ln x+C)$。`, '该线性方程的积分因子为1；x>0。')], '新方程也可按线性公式处理，但直接积分更简洁。'),
    route('r-missed', '令 u=y/x 后，把 y′ 直接写成 xu′', [step(S.homogeneous, 'M.homogeneous_equation_first_order', s`$y=xu$`, '误写y′=xu′，遗漏乘积求导中的u。', '必须用乘积法则y′=u+xu′。')], '遗漏u导致换元后的方程错误。', bad),
  ], op('ode', op('add', op('divide', v, v), c)), '优先选择马上得到可直接积分的新方程的路线'),
  question('own.ode.homogeneous-quadratic', S.homogeneous, homogeneousGoal, s`在 $x>0$ 上解 $y'=y/x+(y/x)^2$，并注意是否遗漏特殊解。`, s`令 $u=y/x$ 得 $xu'=u^2$。当 $u\ne0$ 时 $du/u^2=dx/x$，得到 $-1/u=\ln x+C$，故 $y=-x/(\ln x+C)$（分母非零的区间上）。另有 $u=0$ 对应 $y=0$。`, [
    route('r-homogeneous', '齐次换元后分离变量，最后补回除以 u² 时可能丢掉的解', [step(S.homogeneous, 'M.homogeneous_equation_first_order', s`$y'=y/x+(y/x)^2$`, s`$xu'=u^2$`, 'y=xu，正确使用乘积求导。'), step('S.ode.separable', 'M.separation_of_variables', s`$u'=u^2/x$`, s`$-1/u=\ln x+C$，并补 $u=0$；回代得到所有上述解。`, '分离时除以u²须单独检查u=0。')], '变量可分离，特殊解与定义区间也保留。', main),
    route('r-bernoulli', '齐次换元后把新方程视为伯努利型，用倒数线化，另查零解', [step(S.homogeneous, 'M.homogeneous_equation_first_order', s`$y'=y/x+(y/x)^2$`, s`$u'=u^2/x$`, '实际令u=y/x，正确使用y′=u+xu′。'), step(S.bernoulli, 'M.bernoulli_substitution', s`$u'+0u=u^2/x$`, s`$z'=-1/x$`, '令z=1/u只适用于u≠0，u=0需另检。'), step('S.ode.linear_first_order', 'M.constant_variation', s`$z'+0z=-1/x$`, s`$z=-\ln x+C$，$u=1/z$，回代 $y=-x/(\ln x+C_1)$，另补 $y=0$。`, '积分因子为1，回代时保留分母非零区间。')], '可行，但对已可分离的新方程再倒数线化增加了变换层数。'),
    route('r-forgot-zero', '分离时除以 u²，只保留非零解并宣称没有其它解', [step(S.homogeneous, 'M.homogeneous_equation_first_order', '齐次换元', s`$xu'=u^2$`, '换元本身正确。'), step('S.ode.separable', 'M.separation_of_variables', '除以u²后积分', '遗漏u=0对应的y=0。', '除以可能为0的因子前要单独检查零解。')], 'y=0确实满足原方程，除以u²后被丢掉，解集不完整。', { ...bad, failedStep: 1 }),
  ], op('ode', op('add', op('divide', v, v), op('power', op('divide', v, v), c))), '优先减少变换层数，并完整保留特殊解'),
  question('own.ode.homogeneous-trig', S.homogeneous, homogeneousGoal, s`在 $x>0$ 上解 $y'=y/x+\sin(y/x)$，并指出换元后需另外检查什么。`, s`令 $u=y/x$，得 $xu'=\sin u$。在 $\sin u\ne0$ 的区间，$\int du/\sin u=\int dx/x$，所以 $\ln|\tan(u/2)|=\ln x+C$。还需补 $u=k\pi$，即 $y=k\pi x$（$k\in\mathbb Z$）。`, [
    route('r-homogeneous', '先令 u=y/x，再分离变量；除以 sin u 前单独检查零因子', [step(S.homogeneous, 'M.homogeneous_equation_first_order', s`$y'=y/x+\sin(y/x)$`, s`$xu'=\sin u$`, 'y=xu并正确求导。'), step('S.ode.separable', 'M.separation_of_variables', s`$u'=\sin u/x$`, s`$\ln|\tan(u/2)|=\ln x+C$，另补 $u=k\pi$。`, 'sin u≠0时分离，sin u=0时另检常数解。')], '换元后的可分离结构清楚，并保留全部常值分支。', main),
    route('r-inverse-variable', '齐次换元后把 x 看作 u 的函数，分离积分；另查常值 u', [step(S.homogeneous, 'M.homogeneous_equation_first_order', '齐次组合y/x', s`$xu'=\sin u$`, 'x>0。'), step('S.ode.separable', 'M.separation_of_variables', s`$dx/du=x/\sin u$`, s`$dx/x=du/\sin u$，同样积分，并单独加入 $u=k\pi$。`, '仅在sin u≠0的局部区间倒转变量关系。')], '局部非零分支可行，但倒转变量关系需要额外条件。'),
    route('r-forgot', '除以 sin u 积分后，就认为所有解已经得到', [step(S.homogeneous, 'M.homogeneous_equation_first_order', '齐次换元', s`$xu'=\sin u$`, '换元合法。'), step('S.ode.separable', 'M.separation_of_variables', '除以sin u', '未保留sin u=0对应的常值分支。', '零因子分支必须另检。')], '遗漏u=kπ，也就遗漏y=kπx这些解。', { ...bad, failedStep: 1 }),
  ], op('ode', op('add', op('divide', v, v), op('sin', op('divide', v, v)))), '优先保留原变量关系，在最少额外条件下分离并补特殊解'),
];

export const legacyRouteTargets = [
  { id: 'RT.limit.cancellation', scenarioId: S.zero, methodId: 'M.taylor_expansion', name: zeroGoal, questions: zeroQuestions },
  { id: 'RT.limit.infinity-cancellation', scenarioId: S.inf, methodId: 'M.rationalization', name: infGoal, questions: infQuestions },
  { id: 'RT.limit.power-transform', scenarioId: S.power, methodId: 'M.log_transform', name: powerGoal, questions: powerQuestions },
  { id: 'RT.limit.continuity', scenarioId: S.continuity, methodId: 'M.one_sided_limit', name: continuityGoal, questions: continuityQuestions },
  { id: 'RT.deriv.implicit-chain', scenarioId: S.implicit, methodId: 'M.implicit_differentiation', name: implicitGoal, questions: implicitQuestions },
  { id: 'RT.indefint.substitution', scenarioId: S.sub, methodId: 'M.first_substitution', name: subGoal, questions: subQuestions },
  { id: 'RT.indefint.parts', scenarioId: S.product, methodId: 'M.integration_by_parts', name: productGoal, questions: productQuestions },
  { id: 'RT.defint.sign-split', scenarioId: S.absolute, methodId: 'M.newton_leibniz', name: absoluteGoal, questions: absoluteQuestions },
  { id: 'RT.ode.homogeneous-chain', scenarioId: S.homogeneous, methodId: 'M.homogeneous_equation_first_order', name: homogeneousGoal, questions: homogeneousQuestions },
];

export const firstBatchTargets = buildFirstBatch(legacyRouteTargets);
export const preparedRouteTargets = extendPreparedTargets([...legacyRouteTargets, ...firstBatchTargets], questionBanks, questionBankTaxonomy);
