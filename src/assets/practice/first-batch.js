import originals from './first-batch-originals.json' with { type: 'json' };

// Existing problems grouped by a teaching goal, not claimed to be generated
// descendants of one textbook exercise. Classic selection remains user-owned.
const s = String.raw;
const V = { op: 'var' }, C = { op: 'const' };
const o = (op, ...args) => ({ op, args });
const S = { zero: 'S.limit.0over0', inf: 'S.limit.inf_over_inf', difference: 'S.limit.inf_minus_inf', power: 'S.limit.one_to_inf',
  implicit: 'S.deriv.implicit_derivative', composite: 'S.deriv.composite_derivative', tangent: 'S.deriv.tangent_normal',
  exponent: 'S.deriv.power_exponential', higher: 'S.deriv.higher_order' };
const M = { eq: 'M.equiv_infinitesimal', rational: 'M.rationalization', highest: 'M.divide_highest_power', lh: 'M.lhopital',
  taylor: 'M.taylor_expansion', log: 'M.log_transform', important: 'M.important_limit', implicit: 'M.implicit_differentiation',
  chain: 'M.chain_rule', tangent: 'M.tangent_normal_equation', parametric: 'M.parametric_differentiation',
  logdiff: 'M.logarithmic_differentiation', leibniz: 'M.leibniz_formula', partial: 'M.partial_fraction' };
const step = (scenarioId, methodId, state, transformedState, condition) => ({ scenarioId, methodId, state, transformedState, condition });
const route = (id, summary, steps, reason, preferred = false) => ({ id, summary, steps, reason, preferred, valid: true,
  condition: steps.map((entry) => entry.condition).join('；') });
const wrong = (id, summary, steps, reason, failedStep = 0) => ({ ...route(id, summary, steps, reason), valid: false, failedStep });
const sourceRecord = (id) => originals.find((entry) => entry.id === id);
function q(id, entranceScenarioId, question, solution, routes, structure, comparisonCriterion, external) {
  const original = typeof id === 'number' ? sourceRecord(id) : null;
  return { format: 'route-v1', entranceScenarioId, question, solution, routes, structure,
    variables: ['x', 'y', 'a', 'b', 'n', 't'], comparisonCriterion,
    metadata: { motherId: original ? `candidate.bank402.${id}` : `candidate.${id}`, source: original
      ? { kind: 'dataset_import', label: `原题库第 ${id} 题（已补充核对）`, reference: original.source, originalId: id }
      : external, originalRecord: original, reviewStatus: 'worked_example_checked', userApprovedClassic: false, contentVersion: 1,
      answerAudit: { originalAnswerPreserved: Boolean(original), method: '独立推导；定理条件检查；可计算项用符号或数值辅助复核',
        originalAnswerIsReference: false },
      invariants: ['保留题面完整条件与所问目标', '每条路线独立检查适用范围'],
      allowedVariations: ['第三阶段改变条件后重新判定路线', '第三阶段增加转折并重新核对答案'],
      variantGenerationStage: 3 } };
}

export function buildFirstBatch(legacy) {
  const own = (id) => structuredClone(legacy.flatMap((target) => target.questions).find((item) => item.metadata.motherId === id));
  const infinity = ['own.limit.root-minus', 'own.limit.two-roots', 'own.limit.rational-difference'].map(own);
  // One original problem can reach either infinity/infinity, or zero/zero after
  // t=1/x. Record the actual new scenario instead of putting every method on S∞−∞.
  for (const item of infinity.slice(0, 2)) {
    const second = item.metadata.motherId.endsWith('two-roots');
    item.routes.splice(2, 0, route('r-reciprocal', '令 t=1/x，把根式差改写成 0/0，再有理化', [
      step(S.difference, M.rational, item.question,
        second ? s`$t\to0^+，[\sqrt{1+2t}-\sqrt{1-t}]/t$` : s`$t\to0^+，[\sqrt{1+t}-1]/t$`, 'x→+∞，t=1/x>0；这是同一表达式的恒等重写。'),
      step(S.zero, M.rational, '新出现的根式差商', second ? s`$3/[\sqrt{1+2t}+\sqrt{1-t}]\to3/2$` : s`$1/[\sqrt{1+t}+1]\to1/2$`, '共轭和趋于2且非零；0/0在有理化后消除。'),
    ], '换元后入口变成0/0，与直接有理化得到∞/∞是两条合法的处理方向。'));
  }
  infinity.push(q(13, S.inf, s`设 $\displaystyle\lim_{x\to+\infty}(\sqrt{x^2+x+1}-ax-b)=0$，求实常数 $a,b$。`,
    s`把趋于0的差除以 $x$，得 $\sqrt{1+1/x+1/x^2}-a-b/x\to0$，所以 $a=1$。再有理化：$\sqrt{x^2+x+1}-x=(x+1)/(\sqrt{x^2+x+1}+x)\to1/2$，故 $b=1/2$。反代后差确实趋于0。`, [
      route('r-leading', '先用有限极限锁定线性主项，再有理化并比较新的商', [
        step(S.inf, M.highest, '目标差趋于0，将原等式除以x', s`$\sqrt{1+1/x+1/x^2}-a-b/x\to0$，所以 $a=1$。`, 'x→+∞；趋于0的差除以x仍趋于0。'),
        step(S.difference, M.rational, s`$\sqrt{x^2+x+1}-x$`, s`$(x+1)/(\sqrt{x^2+x+1}+x)$`, '此时才已确定两个无穷大主项的系数相同；共轭和为正。'),
        step(S.inf, M.highest, '有理化后的∞/∞', s`$(1+1/x)/(\sqrt{1+1/x+1/x^2}+1)\to1/2$，所以 $b=1/2$。`, 'x>0，可同除x。'),
      ], '先确定必须相消的主项，再求常数差，避免盲猜参数。', true),
      route('r-zero', '先锁定 a，再令 t=1/x，转入 0/0 根式差商', [
        step(S.inf, M.highest, '有限极限对线性主项的要求', '同除x得a=1。', '原差趋于0。'),
        step(S.difference, M.rational, '已令a=1的根式差', s`$[\sqrt{1+t+t^2}-1]/t，t\to0^+$`, 't=1/x>0，恒等改写。'),
        step(S.zero, M.rational, '新的0/0根式差商', s`$(1+t)/(\sqrt{1+t+t^2}+1)\to1/2$，得 $b=1/2$。`, '共轭和非零。'),
      ], '同一题也能通过0/0完成常数项判断。'),
      wrong('r-main-only', '根式与 x 同阶，因此取 a=1、b=0', [step(S.inf, M.highest, '根式与x的比值趋于1', '只确定a，却丢掉了常数差。', '同阶比较不能决定相消后的常数项。')], '比值趋于1不代表差趋于0；常数差为1/2。'),
    ], o('subtract', o('sqrt', o('add', o('power', V, C), V, C)), o('multiply', C, V), C), '先锁定主项，再用恒等变形减少重复求导'));

  const cancellation = [own('own.limit.sin-ratio')];
  cancellation.push(q(17, S.zero, s`求 $\displaystyle\lim_{x\to0}\frac{\sin x-\sin(\sin x)}{x^3}$。`,
    s`恒等式给出分子 $2\cos[(x+\sin x)/2]\sin[(x-\sin x)/2]$。正弦因子等价于 $(x-\sin x)/2$，余弦趋于1；再由 $x-\sin x=x^3/6+o(x^3)$ 得极限 $1/6$。也可分别展开 $\sin x$ 与 $\sin(\sin x)$ 到三阶。`, [
      route('r-factor', '先用和差化积消除外层相消，再处理留下的三阶小量', [
        step(S.zero, M.eq, '两个正弦相减，先作恒等和差化积', s`分子为 $2\cos[(x+\sin x)/2]\sin[(x-\sin x)/2]\sim x-\sin x$。`, '恒等变形后替换的是乘积中的正弦因子，不在原减法中直接替换。'),
        step(S.zero, M.taylor, s`$(x-\sin x)/x^3$`, s`$[x^3/6+o(x^3)]/x^3\to1/6$。`, '一次项已相消，保留三阶项。'),
      ], '先转化结构再选择精度，每一步的等价替换范围明确。', true),
      route('r-nested', '逐层展开嵌套正弦，保留三阶后相减', [
        step(S.zero, M.taylor, '外层sin与内层sin的嵌套', s`$\sin(\sin x)=x-x^3/3+o(x^3)$。`, '内外层都保留三阶，不能只展开其中一层。'),
        step(S.zero, M.taylor, '与sinx的三阶展开相减', s`$[x-x^3/6-(x-x^3/3)+o(x^3)]/x^3\to1/6$。`, '余项为o(x³)。'),
      ], '可行，但要同时追踪内外两层余项。'),
      wrong('r-drop', '两项都等价于 x，直接相减得 0', [step(S.zero, M.eq, '两个一次等价项相减', '错误丢掉三阶差。', '减法相消不能这样使用一阶等价。')], '相同的一次项消失后，三阶项才决定答案。'),
    ], o('divide', o('subtract', o('sin', V), o('sin', o('sin', V))), o('power', V, C)), '优先通过恒等变形减少嵌套余项的追踪'));
  cancellation.push(q(19, S.zero, s`求 $\displaystyle\lim_{x\to0}\frac{\sqrt{1+x}+\sqrt{1-x}-2}{x^2}$。`,
    s`分别有理化得到 $[1/(\sqrt{1+x}+1)-1/(\sqrt{1-x}+1)]/x$。通分后再次有理化，原商恒等于 $-2/[(\sqrt{1+x}+1)(\sqrt{1-x}+1)(\sqrt{1+x}+\sqrt{1-x})]$，极限 $-1/4$。二阶展开也给出分子 $-x^2/4+o(x^2)$。`, [
      route('r-second', '保留二阶展开，让一次项相消后比较主项', [step(S.zero, M.taylor, '两个根式的一次项互相抵消', s`$\sqrt{1\pm x}=1\pm x/2-x^2/8+o(x^2)$，分子为 $-x^2/4+o(x^2)$。`, '|x|<1，平方根的二阶展开适用。')], '只需相同的两份二阶展开，计算短。', true),
      route('r-rational-twice', '先分别有理化，再通分；对剩余根式差再次有理化', [
        step(S.zero, M.rational, '根式和减2', s`商变为 $[1/(\sqrt{1+x}+1)-1/(\sqrt{1-x}+1)]/x$。`, 'x≠0，两个共轭分母为正。'),
        step(S.zero, M.rational, '通分后又出现根式差', s`再乘共轭，得 $-2/[(\sqrt{1+x}+1)(\sqrt{1-x}+1)(\sqrt{1+x}+\sqrt{1-x})]\to-1/4$。`, '再次有理化消除第二个x；没有丢弃相消项。'),
      ], '不用展开也能做通，但变形多。'),
      wrong('r-linear', '各根式只保留 1±x/2，相加减2后判为0', [step(S.zero, M.taylor, '只保留一阶的两个根式', '把真正的二阶项舍掉。', '分母为x²，一阶相消后必须继续。')], '二阶项恰好决定非零答案。'),
    ], o('divide', o('subtract', o('add', o('sqrt', o('add', C, V)), o('sqrt', o('subtract', C, V))), C), o('power', V, C)), '按明确的二阶相消结构，优先减少恒等变形次数'));
  cancellation.push(q(26, S.zero, s`求 $\displaystyle\lim_{x\to0}\frac{\tan x-\sin x}{\ln(1+x^3)}$。`,
    s`先作恒等变形 $\tan x-\sin x=\sin x(1-\cos x)/\cos x$。因子分别等价于 $x$、$x^2/2$，而 $\ln(1+x^3)\sim x^3$，得 $1/2$。三阶展开 $\tan x=x+x^3/3+o(x^3)$、$\sin x=x-x^3/6+o(x^3)$ 也成立。`, [
      route('r-product', '先把相消差改成乘积，再分别比较因子的阶', [
        step(S.zero, M.eq, '相减的tan与sin，先用恒等式', s`$\tan x-\sin x=\sin x(1-\cos x)/\cos x$。`, '0附近cosx非零；先恒等改写再替换。'),
        step(S.zero, M.eq, '新的乘除结构', s`$[x\cdot x^2/2]/x^3\to1/2$。`, 'ln(1+x³)有定义，标准等价作用于因子。'),
      ], '因子结构暴露了三阶来源，无需重复求导。', true),
      route('r-third-order', '两三角函数展开到三阶，再处理对数分母', [step(S.zero, M.taylor, '一次项相消的差', s`分子为 $x^3/2+o(x^3)$。`, '需要保留三阶。'), step(S.zero, M.eq, '三阶分子与对数分母', s`$\ln(1+x^3)\sim x^3$，得 $1/2$。`, '1+x³>0且x→0。')], '也是合法路线，须注意tan的三阶系数。'),
      wrong('r-first-only', 'tan 与 sin 都换成 x，再相减', [step(S.zero, M.eq, '减法中的一阶等价', '误得分子为0。', '减法相消时一阶等价不够。')], '遗漏的三阶差与分母同阶。'),
    ], o('divide', o('subtract', o('tan', V), o('sin', V)), o('log', o('add', C, o('power', V, C)))), '优先把相消改为可合法等价替换的乘除结构'));

  const power = [own('own.limit.power-quad')];
  power.push(q(8, S.power, s`求 $\displaystyle\lim_{x\to0}(1+2x)^{3/\sin x}$。`, s`底数在0附近为正。取对数得 $3\ln(1+2x)/\sin x\to6$，因此原极限为 $e^6$。也可写成 $[(1+2x)^{1/(2x)}]^{6x/\sin x}$。`, [
    route('r-log', '取对数进入 0/0，对数与正弦分别比较主项，再还原指数', [step(S.power, M.log, '1的无界变动次幂', s`$\ln y=3\ln(1+2x)/\sin x$。`, '1+2x>0。'), step(S.zero, M.eq, '新的对数/正弦商', s`$3(2x)/x\to6$，故 $y\to e^6$。`, '正弦在去心邻域非零，乘除结构可等价。')], '两个标准等价式即可决定指数极限。', true),
    route('r-important', '配成重要极限，再判断额外指数的极限', [step(S.power, M.important, '幂指结构', s`$[(1+2x)^{1/(2x)}]^{6x/\sin x}$，内层趋于e。`, '正底数保证这种幂的拆分。'), step(S.zero, M.eq, '额外指数的差商', s`$6x/\sin x\to6$，结果 $e^6$。`, '正弦与x等价，额外指数有有限极限。')], '可行，但需要引入一个额外的幂结构。'),
    wrong('r-base', '底数趋于1，所以结果是1', [step(S.power, M.important, '底数趋于1而指数无界', '忽略两者变化速度。', '不能直接把1代入无界变动次幂。')], '1^∞是未定式，不能这样代入。'),
  ], o('power', o('add', C, o('multiply', C, V)), o('divide', C, o('sin', V))), '优先减少额外变元和幂结构'));
  power.push(q(14, S.power, s`求 $\displaystyle\lim_{x\to0}\left(2e^{x/(1+x)}-1\right)^{(x^2+1)/x}$。`,
    s`令 $v=x/(1+x)$、$u=2(e^v-1)$。取对数后为 $(x^2+1)[\ln(1+u)/u]\,[u/v]\,[v/x]\to1\cdot1\cdot2\cdot1=2$，所以原极限 $e^2$。对数商 $(x^2+1)\ln(2e^{x/(1+x)}-1)/x$ 也可洛必达一次。`, [
      route('r-nested-equivalent', '取对数，再逐层处理 ln、指数小量与内层变量', [step(S.power, M.log, '正底数的幂指极限', s`$(x^2+1)\ln(2e^{x/(1+x)}-1)/x$。`, '底数在0附近为正；1+x非零。'), step(S.zero, M.eq, 'ln(1+u)中的u仍是复合小量', s`拆成 $\ln(1+u)/u$、$u/v$、$v/x$，极限依次为1、2、1。`, 'v=x/(1+x)、u=2(e^v−1)，均趋于0，且去心邻域非零。')], '分层保留变化速度，避免只看最外层。', true),
      route('r-log-derivative', '取对数，核查 0/0 后对整个复合分子求导', [step(S.power, M.log, '原幂指结构', s`$(x^2+1)\ln(2e^{x/(1+x)}-1)/x$。`, '正底数。'), step(S.zero, M.lh, '0/0对数商', s`分子导数为 $2x\ln(2e^{x/(1+x)}-1)+(x^2+1)\frac{2e^{x/(1+x)}}{(1+x)^2(2e^{x/(1+x)}-1)}\to2$。`, '附近可导，分母导数为1，再还原指数。')], '正确，但需同时使用乘积和复合求导。'),
      wrong('r-inner-lost', '只将底数换成1，认为复杂指数没有影响', [step(S.power, M.important, '底数趋于1', '丢掉底数偏离1的一阶速度。', '无界指数需要联合分析。')], '取对数后的指数极限是2，结果并非1。'),
    ], o('power', o('subtract', o('multiply', C, o('exp', o('divide', V, o('add', C, V)))), C), o('divide', o('add', o('power', V, C), C), V)), '优先分层使用标准小量，减少复合求导'));
  power.push(own('own.limit.power-cos'));

  const implicit = [];
  implicit.push(q(64, S.implicit, s`求方程 $e^y+xy=e$ 所确定的可微隐函数的 $y'$，说明公式的适用条件。`,
    s`逐项求导：$e^y y'+y+xy'=0$，故 $y'=-y/(e^y+x)$，用于 $e^y+x\ne0$ 的局部隐函数分支。`, [
      route('r-implicit', '方程两边求导，对含 y 的项用链式与乘积法则，再解出 y′', [step(S.implicit, M.implicit, '隐式方程', s`对x求导，含y的项必须保留y′。`, '局部把y看作x的函数。'), step(S.composite, M.chain, 'e^{y(x)}与xy(x)', s`$e^y y'+y+xy'=0$，整理得 $-y/(e^y+x)$。`, '整理时e^y+x非零。')], '不必解出显函数即可求导。', true),
      route('r-log-rewrite', '先写 y=ln(e−xy)，再对这个仍含 y 的等式求导整理', [step(S.implicit, M.chain, '先恒等改写y=ln(e−xy)', s`$y'=(-y-xy')/(e-xy)$。`, '原方程保证e−xy=e^y>0；y仍是函数。'), step(S.implicit, M.implicit, '导数等式仍含y′', s`$(e^y+x)y'=-y$，得同一公式。`, 'e^y+x非零；没有把右侧的y当常数。')], '可以，但引入对数反而增加整理。'),
      wrong('r-constant-y', '对 e^y 求导时只写 e^y，对 xy 只写 y', [step(S.implicit, M.chain, '含y(x)的项', '丢掉所有y′。', 'y不是对x的常数。')], '隐式关系要求逐项跟踪y′。'),
    ], o('implicit', o('add', o('exp', V), o('multiply', V, V)), C), '优先不引入新的函数表示'));
  implicit.push(q(71, S.implicit, s`由 $y^5+2y=x+3x^7$ 确定实隐函数，求 $y'(0)$。`,
    s`x=0时 $y(y^4+2)=0$，所以y=0。求导得 $(5y^4+2)y'=1+21x^6$，因此 $y'(0)=1/2$。$5y^4+2>0$ 保证所需局部分支可微。`, [
      route('r-point-first', '先确定切点，再对原方程求导，最后代入', [step(S.implicit, M.implicit, '代入x=0确定y=0，然后求导', s`$(5y^4+2)y'=1+21x^6$。`, '实数y^4+2>0，切点唯一。'), step(S.composite, M.chain, '隐式求导中y^5的链式因子', s`$y'= (1+21x^6)/(5y^4+2)$，在(0,0)为1/2。`, '5y⁴+2始终非零。')], '先明确代入点，避免误代未知y。', true),
      route('r-general-first', '先求一般导数，再由原方程确定 x=0 对应的 y', [step(S.implicit, M.chain, '对y^5与2y求导', s`$(5y^4+2)y'=1+21x^6$。`, '保留y′。'), step(S.implicit, M.implicit, '解一般导数，随后定位原曲线上的点', s`x=0对应y=0，代入得到1/2。`, '代入前必须满足原方程，分母非零。')], '同样成立，但不能任意指定纵坐标。'),
      wrong('r-y5', '把 y^5 的导数写成 5y^4，不乘 y′', [step(S.implicit, M.chain, '复合幂函数y(x)^5', '遗漏内层导数。', '链式法则要求乘y′。')], '方程两边求导时遗漏内层导数，会改变导数等式。'),
    ], o('implicit', o('add', o('power', V, C), o('multiply', C, V)), o('add', V, o('multiply', C, o('power', V, C)))), '优先明确所求导数对应的曲线点'));
  implicit.push(q(70, S.implicit, s`由 $x-y+\frac12\sin y=0$ 确定隐函数，求 $y''$。`,
    s`令 $A=1-\frac12\cos y\ge1/2$。第一次求导得 $Ay'=1$；再次求导为 $Ay''+\frac12\sin y\,(y')^2=0$，故 $y''=-\sin y/(2A^3)$。`, [
      route('r-product-second', '先求 y′，保留导数等式再求导，注意二次出现的链式因子', [step(S.implicit, M.implicit, '原隐式方程', s`$Ay'=1$，$A=1-\cos y/2$。`, 'A≥1/2，无分母为零的问题。'), step(S.composite, M.chain, '对A(y)y′再求导', s`$Ay''+(\sin y/2)(y')^2=0$，代入y′=1/A得结果。`, 'A′=(sin y/2)y′，需乘积法则。')], '保留原导数等式，不用先对复杂分式求商导。', true),
      route('r-quotient', '先整理 y′=1/A，再把它作为复合函数继续求导', [step(S.implicit, M.implicit, '第一次隐式求导', s`$y'=1/A$。`, 'A非零。'), step(S.composite, M.chain, '复合倒数1/A(y)', s`$y''=-A^{-2}(\sin y/2)y'=-\sin y/(2A^3)$。`, '对A关于x求导时还须乘y′。')], '可行，但要小心倒数与内层的两个因子。'),
      wrong('r-second-missed', '第二次求导将 cos y 的导数写成 −sin y，不乘 y′', [step(S.implicit, M.implicit, '第一次求导正确', 'Ay′=1。', '第一次求导成立。'), step(S.composite, M.chain, '第二次对cos y(x)求导', '遗漏第二次的y′。', '第二次仍需链式法则。')], '会少一个y′，使分母的幂次错误。', 1),
    ], o('derivative', o('implicit', o('subtract', V, V), o('multiply', C, o('sin', V))), C), '优先保留导数等式，减少分式求导'));
  implicit.push(q(75, S.tangent, s`求椭圆 $x^2/16+y^2/9=1$ 在 $(2,3\sqrt3/2)$ 处的切线方程。`,
    s`隐式求导得 $x/8+(2y/9)y'=0$，切点斜率 $-\sqrt3/4$。点斜式整理得 $3x+4\sqrt3y=24$。也可用 $x=4\cos t,y=3\sin t$，切点对应 $t=\pi/3$，参数求导给出同一斜率。`, [
      route('r-implicit-line', '对椭圆隐式求导，代入切点求斜率，再写点斜式', [step(S.tangent, M.implicit, '隐式椭圆与已知切点', s`$y'=-9x/(16y)$，切点为 $-\sqrt3/4$。`, '切点在曲线上且y非零。'), step(S.tangent, M.tangent, '已知点与斜率', s`$y-3\sqrt3/2=-(\sqrt3/4)(x-2)$，即 $3x+4\sqrt3y=24$。`, '有限斜率可以用点斜式。')], '无需引入参数，直接使用已知切点。', true),
      route('r-parametric-line', '先参数化椭圆，求 dy/dx，再回到切线方程', [step(S.tangent, M.parametric, 'x=4cos t、y=3sin t', s`切点对应t=π/3，$dy/dx=-3\cos t/(4\sin t)$。`, 'dx/dt在该点非零。'), step(S.tangent, M.tangent, '参数导数给出的斜率', s`斜率为 $-\sqrt3/4$，点斜式得到 $3x+4\sqrt3y=24$。`, '取与指定切点相符的参数。')], '路线有效，但额外参数化较长。'),
      wrong('r-coordinate-slope', '把切点的 y/x 当成切线斜率', [step(S.tangent, M.tangent, '切点坐标', '将原点到切点的连线当切线。', '切线斜率应来自导数。')], 'y/x是连线斜率，不是椭圆在该点的切线斜率。'),
    ], o('tangent', o('add', o('divide', o('power', V, C), C), o('divide', o('power', V, C), C)), o('point', C, C)), '优先利用现成的隐式方程与切点'));

  const exponent = [];
  exponent.push(q('pku.hw05.3a', S.exponent, s`求 $y=a^{\sin x}$ 的导数，其中 $a>0$ 为常数。`,
    s`写为 $y=e^{(\ln a)\sin x}$，链式求导得 $y'=a^{\sin x}\ln a\cos x$。也可对正函数取对数：$\ln y=\sin x\ln a$，求导后乘回y。a=1时两种方法都给出0。`, [
      route('r-exp-chain', '写成指数复合函数，再由外向内求导', [step(S.exponent, M.chain, 'a^{sin x}=e^{(ln a)sin x}', s`先保留外层指数函数，再求内层。`, 'a>0，对数存在，a=1也可用。'), step(S.composite, M.chain, '(ln a)sin x作为内层', s`内层导数为 $\ln a\cos x$，故 $y'=a^{\sin x}\ln a\cos x$。`, 'a是常数，不对a求导。')], '固定底数无需建立额外隐式导数等式。', true),
      route('r-log', '对正函数取对数，隐式求导后乘回 y', [step(S.exponent, M.logdiff, '正函数y', s`$\ln y=\sin x\ln a$。`, 'a>0，所以y>0。'), step(S.implicit, M.implicit, '取对数后的等式', s`$y'/y=\cos x\ln a$，乘回y得相同结果。`, 'y非零。')], '对数求导也合法。'),
      wrong('r-power', '把 sin x 当常指数，按幂函数公式求导', [step(S.exponent, M.chain, '固定底数与变动指数', '把指数函数误当幂函数。', '指数依赖x，不能套常指数幂函数规则。')], '必须区分固定底数与固定指数。'),
    ], o('derivative', o('power', C, o('sin', V))), '固定底数时优先直接链式求导',
    { kind: 'public_course_problem', label: '北京大学高等数学A公开作业5，第3题(a)', reference: 'hw05.pdf，第1页', url: 'https://math.pku.edu.cn/teachers/wangjj/2021fall/hw05.pdf',
      originalText: 'y=a^{sin x}', answerProvided: false, editorialNote: '整理为独立题面，并明确实指数函数的必要条件a>0。' }));
  exponent.push(q(54, S.exponent, s`求 $y=x^{\sin x}$ 的导数，$x>0$。`,
    s`$\ln y=\sin x\ln x$，所以 $y'/y=\cos x\ln x+\sin x/x$，即 $y'=x^{\sin x}(\cos x\ln x+\sin x/x)$。等价写法 $y=e^{\sin x\ln x}$ 可由链式与乘积法则直接求导。`, [
      route('r-log-product', '取对数把变底变指数化为乘积，再隐式求导', [step(S.exponent, M.logdiff, 'x与sinx同时变化', s`$\ln y=\sin x\ln x$。`, 'x>0且y>0。'), step(S.implicit, M.implicit, 'lny等于两个函数乘积', s`$y'/y=\cos x\ln x+\sin x/x$，再乘回y。`, '乘积求导必须保留两项。')], '两种变化分别进入乘积求导，结构清楚。', true),
      route('r-exp', '先写成 exp(sin x·ln x)，再逐层求导', [step(S.exponent, M.chain, '将幂指式恒等重写', s`$y=e^{\sin x\ln x}$。`, 'x>0。'), step(S.composite, M.chain, '外层指数与内层乘积', s`$y'=e^{\sin x\ln x}(\cos x\ln x+\sin x/x)$。`, '内层用乘积法则。')], '显式链式路线也成立。'),
      wrong('r-fixed-index', '按常指数公式写成 sin x·x^{sin x−1}', [step(S.exponent, M.chain, '变动指数', '遗漏指数变化带来的lnx项。', 'sinx不是常数。')], '会漏掉x^{sinx}cosx lnx这一项。'),
    ], o('derivative', o('power', V, o('sin', V))), '优先清楚分离底数与指数的变化'));
  exponent.push(q(66, S.exponent, s`求 $y=\sqrt{\frac{(x-1)(x-2)}{(x-3)(x-4)}}$ 的导数，说明公式在哪些实数区间适用。`,
    s`在被开方商 $R>0$ 的区间 $(-\infty,1),(2,3),(4,+\infty)$，$y>0$。用 $\ln y=\frac12[\ln|x-1|+\ln|x-2|-\ln|x-3|-\ln|x-4|]$ 得 $y'=\frac y2[1/(x-1)+1/(x-2)-1/(x-3)-1/(x-4)]$。也可直接求 $R'$ 后用 $y'=R'/(2\sqrt R)$。x=1,2虽然函数有值，但不在上述可微开区间内。`, [
      route('r-absolute-log', '先检查实数定义域，再用绝对值对数拆开乘除结构', [step(S.exponent, M.logdiff, 'R>0的根式乘除结构', s`$\ln y=\frac12[\ln|x-1|+\ln|x-2|-\ln|x-3|-\ln|x-4|]$。`, 'R>0而非每个因子都正；必须使用绝对值。'), step(S.implicit, M.implicit, '对数等式', s`求导后乘回y，得到四个倒数的线性组合。`, '只用于上述开区间，不在零点或极点除以y。')], '把复杂商导化成四个简单倒数。', true),
      route('r-root-quotient', '直接把根式作为复合函数，对里面的商用乘积、商法则', [step(S.exponent, M.chain, 'y=√R', s`$y'=R'/(2\sqrt R)$。`, 'R>0。'), step(S.composite, M.chain, 'R中的乘除因子', '按商法则计算R′，结果等价于四倒数表达式。', 'x≠3,4且仍须R>0。')], '不取对数也合法，但商导的展开较长。'),
      wrong('r-positive-factors', '在整个定义域直接拆成 ln(x−1)+ln(x−2)−ln(x−3)−ln(x−4)', [step(S.exponent, M.logdiff, '实数乘除结构', '把负因子也放入无绝对值的实对数。', 'R>0不代表每个因子都正。')], '在x<1或2<x<3有负因子，必须写ln|x−c|，否则路线不覆盖整个所问范围。'),
    ], o('derivative', o('sqrt', o('divide', o('multiply', o('subtract', V, C), o('subtract', V, C)), o('multiply', o('subtract', V, C), o('subtract', V, C))))), '优先减少商法则展开，同时覆盖全部可微区间'));
  exponent.push(q(68, S.composite, s`已知 $f(x/2)=\sin x$。分别求 $f'[f(x)]$ 与 $(f[f(x)])'$。`,
    s`令u=x/2得 $f(u)=\sin(2u)$，所以 $f'(u)=2\cos(2u)$。因此 $f'[f(x)]=2\cos(2\sin2x)$；而 $(f[f(x)])'=f'[f(x)]f'(x)=4\cos(2\sin2x)\cos2x$。两种写法所求对象不同。`, [
      route('r-restore-first', '先还原 f 的表达式，再区分导函数代值与复合函数求导', [step(S.composite, M.chain, 'f(x/2)=sinx，先换元还原f', s`$f(u)=\sin2u$，$f'(u)=2\cos2u$。`, '原恒等式对实数成立；换元覆盖实数。'), step(S.composite, M.chain, 'f′[f(x)]与(f∘f)′', s`前者只代值，后者额外乘 $f'(x)$，得到上述两个结果。`, '代入导函数不等于对整体复合再求导。')], '先明确函数和所求对象，避免把两者混淆。', true),
      route('r-differentiate-first', '先对给定恒等式求导，再代入适当变量得到 f′，最后处理复合', [step(S.composite, M.chain, '对f(x/2)=sinx求导', s`$f'(x/2)/2=\cos x$，所以 $f'(u)=2\cos2u$。`, '保留内层x/2的导数1/2。'), step(S.composite, M.chain, '分别代值和复合求导', '得到同样的两个表达式。', '整体复合求导需额外乘f′(x)。')], '可行，但容易漏掉第一次内层的1/2。'),
      wrong('r-same', '认为两种写法都是同一个导数，因此结果相同', [step(S.composite, M.chain, '两种不同的求值符号', '混淆导函数代值与整体求导。', '只有整体求导才需再乘内层导数。')], '后一项必须额外乘f′(x)。'),
    ], o('derivative_composition', o('sin', o('multiply', C, V)), o('sin', V)), '优先明确f本身，再区分所求对象'));

  const higher = [];
  higher.push(q(51, S.higher, s`求 $y=\sin(\omega x)$ 的 $n$ 阶导数，$n\ge1$ 为整数、$\omega$ 为实常数。`, s`每次求导提出一个ω，三角函数相位每次增加π/2，故 $y^{(n)}=\omega^n\sin(\omega x+n\pi/2)$。ω=0时结果为0。`, [
    route('r-phase', '跟踪每次链式系数和四次循环，归纳 n 阶公式', [step(S.higher, M.chain, 'sin(ωx)的重复求导', '每次导数提出一个ω。', 'ω为常数。'), step(S.composite, M.chain, '线性内层与三角循环', s`$\omega^n\sin(\omega x+n\pi/2)$。`, '四次循环只改变三角相位，不能丢ω^n。')], '一次观察覆盖所有n。', true),
    wrong('r-one-factor', '三角函数四次循环，因此系数一直只有 ω', [step(S.higher, M.chain, '每次的链式因子', '少乘后续ω。', '每一阶都必须求内层导数。')], '一般n时系数为ω^n，不是ω。'),
    wrong('r-sign', '每次求导只换正负号，不在 sin 与 cos 之间切换', [step(S.higher, M.chain, '三角导数循环', '把一阶导数误写为−sin。', 'sin的一阶导数是cos。')], '四次循环包括sin、cos与符号，不能只改变符号。'),
  ], o('derivative', o('sin', o('multiply', C, V)), C), '优先归纳通项，避免逐次列出n个导数'));
  higher.push(q(50, S.higher, s`求 $y=x^2e^{-x}$ 的十阶导数。`, s`莱布尼茨公式中多项式三阶起为0，只保留k=0,1,2。一般式 $y^{(n)}=e^{-x}(-1)^n[x^2-2nx+n(n-1)]$，故十阶为 $e^{-x}(x^2-20x+90)$。也可设 $y^{(n)}=e^{-x}P_n(x)$，递推 $P_{n+1}=P_n'-P_n$ 后归纳。`, [
    route('r-truncate', '先求指数因子的导数规律，再用莱布尼茨截断到三项', [step(S.higher, M.chain, '指数因子e^{−x}', s`$(e^{-x})^{(k)}=(-1)^k e^{-x}$。`, '每次链式提出−1。'), step(S.higher, M.leibniz, '多项式与指数的乘积', s`k=0,1,2三项给出 $e^{-x}(x^2-20x+90)$。`, 'x²的三阶以上导数为0，组合数必须保留。')], '十阶也只需三项计算。', true),
    route('r-recurrence', '用乘积求导建立多项式递推，再归纳到十阶', [step(S.higher, M.leibniz, '先使用一阶乘积法则', s`设 $y^{(n)}=e^{-x}P_n$，得 $P_{n+1}=P_n'-P_n$。`, '莱布尼茨在n=1时即乘积法则。'), step(S.higher, M.leibniz, '递推中的多项式结构', s`归纳 $P_n=(-1)^n[x^2-2nx+n(n-1)]$，代n=10。`, '初值P0=x²；递推须包含−Pn。')], '路线成立，但归纳步骤比直接截断多。'),
    wrong('r-product-of-derivatives', '把十阶导数写成两个因子的十阶导数相乘', [step(S.higher, M.leibniz, '两个因子的乘积', '忽略所有混合导数项。', '乘积高阶导数需要组合数求和。')], '多项式十阶导数虽为0，乘积十阶导数并不为0。'),
  ], o('derivative', o('multiply', o('power', V, C), o('exp', o('multiply', C, V))), C), '优先利用多项式高阶导数为零的有限项截断'));
  higher.push(q(53, S.higher, s`求 $y=x/(x^2-1)$ 的 $n$ 阶导数，$x\ne\pm1$，$n\ge1$ 为整数。`,
    s`拆成 $\frac12[(x-1)^{-1}+(x+1)^{-1}]$。链式递推给出 $y^{(n)}=\frac{(-1)^n n!}{2}[(x-1)^{-n-1}+(x+1)^{-n-1}]$。也可对 $(x^2-1)y=x$ 反复用莱布尼茨，n≥2时得到 $(x^2-1)y^{(n)}+2nx y^{(n-1)}+n(n-1)y^{(n-2)}=0$。`, [
      route('r-partial', '先拆成简单分式，再对平移幂函数归纳求导', [step(S.higher, M.partial, '有理式x/(x²−1)', s`$y=\frac12[(x-1)^{-1}+(x+1)^{-1}]$。`, 'x≠±1。'), step(S.composite, M.chain, '两个平移幂函数', s`每项n阶为 $(-1)^n n!(x\mp1)^{-n-1}$，线性组合得结果。`, '内层斜率都是1，重复求导保留阶乘。')], '部分分式把商导变成两份同类公式。', true),
      route('r-implicit-product', '保留乘积恒等式，用莱布尼茨逐阶建立递推', [step(S.higher, M.leibniz, '(x²−1)y=x的高阶导数', '展开后只需多项式0、1、2阶导数。', 'n≥2时右侧导数为0；一阶须单独处理。'), step(S.higher, M.leibniz, '递推恢复所需n阶导数', '由y与y′开始，逐阶递推得到同一表达式。', '除以x²−1时仍须x≠±1。')], '数学可行，但逐阶递推比拆分通项长。'),
      wrong('r-ratio', '分别求分子和分母的 n 阶导数，再作商', [step(S.higher, M.partial, '商式高阶求导', '套用不存在的分子分母分别求导公式。', '商的导数不是导数之商。')], '这种规则连一阶都不成立。'),
    ], o('derivative', o('divide', V, o('subtract', o('power', V, C), C)), C), '优先得到直接通项，减少逐阶商导'));
  higher.push(q(56, S.higher, s`求 $y=\sin^6x+\cos^6x$ 的 $n$ 阶导数，$n\ge1$ 为整数。`, s`先用 $a^3+b^3=(a+b)^3-3ab(a+b)$，其中a=sin²x、b=cos²x，得 $y=1-3\sin^2x\cos^2x=5/8+(3/8)\cos4x$。故 $y^{(n)}=(3/8)4^n\cos(4x+n\pi/2)$，n≥1；n=0必须保留5/8。`, [
    route('r-reduce', '先把三角六次幂化成常数加单个三角函数，再归纳高阶链式因子', [step(S.higher, M.chain, '先恒等化简，识别单个cos4x', s`$y=5/8+(3/8)\cos4x$。`, 'sin²x+cos²x=1，恒等式对实数x成立。'), step(S.composite, M.chain, '线性内层4x的反复求导', s`$y^{(n)}=(3/8)4^n\cos(4x+n\pi/2)$。`, 'n≥1，常数项消失，每阶提出4。')], '先改变结构，六重乘积变成单个三角函数。', true),
    route('r-six-products', '保留六重乘积，反复莱布尼茨并逐项链式求导', [step(S.higher, M.leibniz, 'sin和cos的六重乘积', '对n1+…+n6=n的所有组合，用多项式系数组合六个因子的各阶导数。', '有限的高阶乘积求和公式成立。'), step(S.composite, M.chain, '每个三角因子的导数循环', 'sin因子各阶为sin(x+nkπ/2)，cos因子类似；求和得到同一结果。', '每一项须保留n!/(n1!…n6!)。')], '路线合法，但项数很多，适合比较为何先化简更自然。'),
    wrong('r-squares', '由 sin²x+cos²x=1 直接认定 sin⁶x+cos⁶x=1，因此所有导数为0', [step(S.higher, M.chain, '不同幂次的三角和', '把平方和恒等式直接用于六次幂。', '平方和为1不意味着六次幂之和也为1。')], 'sin⁶x+cos⁶x有非零的cos4x项，不能判为常数。'),
  ], o('derivative', o('add', o('power', o('sin', V), C), o('power', o('cos', V), C)), C), '优先减少需要高阶乘积求导的因子数'));

  const targets = [
    ['infinity', S.difference, M.rational, '无穷大相消后，判断新的商式与参数条件', infinity, 'candidate.bank402.13'],
    ['cancellation', S.zero, M.taylor, '相消后保留有效阶，检查替换是否仍成立', cancellation, 'candidate.bank402.26'],
    ['power', S.power, M.log, '幂指变化转化后，继续判断新的极限结构', power, 'candidate.bank402.14'],
    ['implicit', S.implicit, M.implicit, '隐式关系中的导数如何继续用于二阶或切线', implicit, 'candidate.bank402.70'],
    ['expression', S.exponent, M.logdiff, '求导前检查表达式、内层变化和适用区间', exponent, 'candidate.bank402.66'],
    ['higher', S.higher, M.leibniz, '先改变表达式结构，再决定高阶求导路线', higher, 'candidate.bank402.50'],
  ];
  return targets.map(([id, scenarioId, methodId, name, questions, motherCandidateId]) => ({
    id: `RT.batch1.${id}`, scenarioId, methodId, name, batchId: 'limits-derivatives-20261011',
    questions: questions.map((item, index) => ({ ...item, metadata: { ...item.metadata, trainingGoal: name, batchId: 'limits-derivatives-20261011',
      rootId: `ROOT.batch1.${id}`, motherCandidateId, relationship: 'related_existing_problem',
      trainingRole: index === 0 ? 'foundation' : index === 3 ? 'transfer' : 'chain', complexity: index + 1,
      userApprovedClassic: false, variantGenerationStage: 3 } })),
  }));
}
