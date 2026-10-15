// One-time, repeatable source migration. The audit deliverables and original
// 402 input are evidence, never mutation targets. No learner database is opened.
import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestTasks } from '../src/core/practice/classification.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const asset = resolve(root, 'frontend/src/assets/skeleton');
const archive = resolve(root, '题库整理/knowledge-v2');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const snapshot = async (path, relative) => {
  const target = resolve(archive, '迁移前备份', relative);
  await mkdir(dirname(target), { recursive: true });
  try { await copyFile(path, target, 1); } catch (e) { if (e.code !== 'EEXIST') throw e; }
};
const files = Object.fromEntries(await Promise.all((await readdir(asset)).filter(f => f.endsWith('.json')).map(async f => {
  await snapshot(resolve(asset, f), `skeleton/${f}`); return [f, await read(resolve(asset, f))];
})));
const methods = () => Object.values(files).flatMap(f => f.methods ?? []);
const scenes = () => Object.values(files).flatMap(f => f.scenarios ?? []);
const method = id => methods().find(m => m.id === id);
const scene = id => scenes().find(s => s.id === id);
const edge = (sid, mid, condition) => {
  const s = scene(sid), old = s.methods.find(m => m.method_id === mid);
  if (old) old.when_to_prefer = condition;
  else s.methods.push({ method_id: mid, priority: s.methods.length + 1, when_to_prefer: condition });
};
function addMethod(block, id, name, definition, steps, preconditions, pitfalls) {
  if (method(id)) return;
  files[`methods.${block}.json`].methods.push({ id, name, aliases: [name], one_liner: definition,
    definition, block_ids: [], applies_to_scenarios: [], triggers: [definition], steps, preconditions,
    not_applicable: [], pitfalls, relations: [], difficulty: 2, frequency: 'medium', exam_notes: definition,
    example_problems: [] });
}
function addScene(block, group, id, name, definition, signals, examples, pairs) {
  if (!scene(id)) files[`scenarios.${block}.json`].scenarios.push({ id, block_id: `B.${block}`, name,
    definition, signals, recognition_examples: examples, distinguish_from: [], methods: [] });
  const g = files['scenario_groups.json'].blocks.find(b => b.block_id === `B.${block}`).groups.find(g => g.id === group);
  if (!g.scenario_ids.includes(id)) g.scenario_ids.push(id);
  for (const [mid, condition] of pairs) edge(id, mid, condition);
}

addMethod('limit', 'M.counterexample_sequences', '用两条趋近数列反证', '找两列都趋于同一点、函数值却趋于不同值的数，证明极限不存在。',
  ['构造两条定义域内的数列，检查都趋于目标点', '分别算函数值的极限', '两个极限不同，原函数在该点就没有极限'],
  ['两列须处于原函数定义域内且趋于同一目标点', '只用来否定极限；两列结果相同不足以证明存在'], ['有界不代表有极限', '不能只检验两条路径就宣称极限存在']);
addMethod('limit', 'M.product_telescoping', '连乘递推相消', '利用相邻因子的恒等式，把一长串乘积压成首尾几项，再求极限。',
  ['找能连接相邻因子的恒等式', '先对有限项相乘，写出首尾表达式', '确认分母非零，再对闭式取极限'],
  ['须有确切的有限乘积恒等式', '相除时分母不能为零'], ['不能将每个因子的极限直接乘成无限乘积的极限', '二倍角相消时不能漏掉2的幂']);
addMethod('limit', 'M.polynomial_division', '多项式除法', '把假分式拆成整式加真分式，露出增长项和余项；求极限、求导、积分都可能用到。',
  ['按最高次项相除，得到商的下一项', '减去该项乘分母，再继续相除', '余式次数低于分母后写成商加余式除分母'],
  ['分子分母是多项式，分母不是零多项式', '恒等式只在原分母非零处使用'], ['余式不能丢掉；相消后它可能决定答案']);
addMethod('limit', 'M.finite_limit_constraint', '用有限极限约束系数', '题目说整体趋于有限值时，先合并所有可能相消的增长项，再令剩余发散项的系数为零。',
  ['先完成恒等变形，合并同阶项', '证明余项趋零或不足以抵消主项', '由目标极限有限，列出发散项系数为零的方程', '再用常数极限确定剩余参数并反代'],
  ['题设明确要求有限极限', '已证明剩余项不能抵消被约束的发散项'], ['不能在合并前把各项系数分别设为零', '不能事先假定未知参数为正或非零']);
addMethod('limit', 'M.pointwise_limit', '先固定自变量求点态极限', '含n的函数列先把x当成固定数，再按x的范围求n趋于无穷时的值，得到一个新函数。',
  ['先固定x，区分影响数列趋势的x取值', '分别求每个分支的n极限', '拼成极限函数，再回答连续性等后续问题'],
  ['每个讨论点的数列极限有依据', '固定x求n极限和对极限函数求x极限是两件事'], ['不能未经证明交换两个极限', '边界点必须单独检查']);
addMethod('limit', 'M.continuity_rules', '用连续性求极限', '确认表达式在目标点连续且有定义，才直接代入；也可证明一个分支内部连续。',
  ['检查基本函数和复合运算的定义域', '确认分母非零、对数或根式条件成立', '用连续函数的运算和复合性质取极限'],
  ['目标点附近及目标点处的表达式满足所用连续性条件'], ['直接代入遇到0/0时不能继续当作普通除法', '有界性不是连续性']);
addMethod('deriv', 'M.inverse_derivative', '反函数求导', '原函数在对应点可导且导数不为零时，反函数导数是原函数导数的倒数；回到原变量前要核对分支。',
  ['选定一一对应的区间和反函数分支', '在对应点检查原函数导数非零', '取导数倒数并用原变量表达'],
  ['原函数在所用局部区间存在反函数且满足反函数求导定理', '对应点的原函数导数非零'], ['反三角函数的值域决定平方根符号', '不能交换原函数变量与反函数变量']);
addMethod('mvt', 'M.model_objective_function', '建立目标函数', '把题目问的面积、长度、成本等量写成变量的函数，同时写清约束和允许区间。',
  ['选择有明确意义的变量', '用题设关系表示其它量', '列出目标函数和定义域，再选择求最值的方法'],
  ['变量意义、单位和约束须与题面一致'], ['周长不能当半径', '建好函数还没完成最值判断']);
addMethod('mvt', 'M.complete_square', '配方求二次式最值', '把二次式写成平方项加常数；再检查平方项为零的点是否落在允许区间。',
  ['配成A(x-h)²+k', '根据A的符号判断开口', '检查顶点与区间；顶点不在区间时比较端点'],
  ['目标是实二次式', '变量的允许区间已明确'], ['顶点不在定义域时不能直接取顶点值']);
addMethod('limit', 'M.combine_fractions', '通分法', '把分式的差合成一个商，保留可能相消的项，再判断新的极限情景。',
  ['检查各分母非零', '选公共分母并完整合并分子', '化简后重新检查分子分母的趋势'], ['原式和变形后的公共分母在讨论范围内非零'], ['减号必须作用于整个分子', '通分后不一定是0/0或∞/∞']);
addMethod('limit', 'M.rewrite_as_fraction', '把乘积改写成商', '把趋零量与无界量的乘积改写成商，检查实际得到0/0还是∞/∞，再选择方法。',
  ['选择要写成倒数的因子', '检查该因子在去心邻域非零', '重新判断商的类型和下一步条件'], ['取倒数的因子在所用邻域非零'], ['不能省略符号与定义域检查']);
addMethod('multiint', 'M.partition_domain', '按表达式变化分区', '取整、绝对值或分段函数在不同区域有不同表达式时，先分清区域，再分别计算并相加。',
  ['找到表达式变化的边界', '在各区域确定正确的表达式', '逐块积分并相加，核对是否重叠或遗漏'],
  ['分区覆盖原积分域，各部分满足所用可积性条件', '忽略边界须有零测度等明确依据'], ['不能把某一块的取整值用于整个区域']);

addScene('limit', 'G.limit.sequence', 'S.limit.function_sequence_limit', '函数列的点态极限', '表达式同时含x和n；先固定x求n的极限，得到随x变化的新函数。',
  ['题目用n趋于无穷的极限定义f(x)', '不同x的范围可能给出不同极限'], ['f(x)=lim_{n→∞} x(1-x^{2n})/(1+x^{2n})'], [['M.pointwise_limit', '先按|x|与1的关系分支，边界点单独计算。']]);
addScene('limit', 'G.limit.infinitesimal', 'S.limit.bounded_times_zero', '有界量乘无穷小', '一个因子趋于零，另一个因子只有统一的有界性，也能证明乘积趋零。',
  ['出现振荡的sin、cos因子', '另一因子趋于零且能给出绝对值上界'], ['lim_{x→∞} sin x/x'], [['M.squeeze_theorem', '先给出振荡因子的统一上界，再由趋零因子夹住乘积。'], ['M.inequality_scaling', '用绝对值不等式构造与振荡无关的上界。']]);
addScene('deriv', 'G.deriv.rules', 'S.deriv.basic_definition', '基本函数的定义法求导', '从增量差商推导常数、幂、指数、对数、三角函数的导数，而不是识别内外层套叠。',
  ['要求从定义推导基本函数的导数', '写出[f(x+h)-f(x)]/h'], ['用定义求sin x的导数', '推导a^x的导数'], [['M.derivative_definition', '先写差商，变形后再用已成立的基本极限。']]);
addScene('deriv', 'G.deriv.rules', 'S.deriv.inverse', '反函数求导', '已知y是某函数的反函数，求导前要确定一一对应的分支与非零导数条件。',
  ['反三角函数求导', '已知x=g(y)，要求dy/dx'], ['y=arccos x，-1<x<1'], [['M.inverse_derivative', '原函数对应点的导数非零时取倒数，核对值域与符号。'], ['M.implicit_differentiation', '也可对原函数关系隐式求导，保留内层导数。']]);
addScene('limit', 'G.limit.indeterminate', 'S.limit.growth_balance', '无穷远增长项的相消', '表达式在无穷远包含多个可能相消的增长项；先比较并合并主项，再求剩余部分的极限。有未知系数时，不预先假定各项都趋于无穷。',
  ['根式、有理式与一次式作差', '相同增长阶可能抵消', '给定整体有限极限，反求系数'], ['已知sqrt(x²+x+1)−ax−b趋于0，求a和b'],
  [['M.finite_limit_constraint', '整体目标有限且余项趋势有依据时，用合并后的增长项约束系数。'], ['M.divide_highest_power', '先缩放比较主项，只确定主项还须继续计算常数差。'], ['M.polynomial_division', '有假有理分式时先拆出整式与真分式。'], ['M.combine_fractions', '分式之差可先通分，参数保留到相消检查之后。']]);
for (const sid of ['S.limit.piecewise_continuity', 'S.limit.discontinuity_classification']) {
  edge(sid, 'M.counterexample_sequences', '怀疑极限不存在时，构造两条定义域内的趋近数列；只用于证否。');
  edge(sid, 'M.continuity_rules', '在分支内部核对定义域，用连续函数的运算与复合性质证明连续。');
}
edge('S.limit.n_term_sum', 'M.product_telescoping', '连乘有相邻恒等式时先对有限项相消，再计算首尾极限。');
edge('S.limit.n_term_sum', 'M.riemann_sum_limit', '能确实写成带网格宽度的黎曼和，并满足所用可积性条件时，转为定积分。');
for (const sid of ['S.limit.inf_minus_inf', 'S.limit.inf_over_inf']) edge(sid, 'M.finite_limit_constraint', '反求参数且整体目标有限时，先合并主项再约束不能被余项抵消的发散系数。');
edge('S.limit.inf_minus_inf', 'M.divide_highest_power', '先比较同阶增长项；只能决定主项时还要继续求相消后的余项。');
edge('S.limit.inf_minus_inf', 'M.taylor_expansion', '换到展开点并证明余项阶数足够后，保留相消后决定结果的项。');
edge('S.limit.inf_minus_inf', 'M.polynomial_division', '差中含假有理分式时，先拆出整式增长项和真分式余项。');
edge('S.indefint.rational_function', 'M.polynomial_division', '假分式先拆成整式与真分式，再决定后续积分方法。');
edge('S.deriv.higher_order', 'M.polynomial_division', '对假有理式先做恒等拆分，再分别求导；余式不能丢掉。');
edge('S.limit.inf_minus_inf', 'M.combine_fractions', '分式作差时完整通分，再重新判断商的类型。');
edge('S.limit.zero_times_inf', 'M.rewrite_as_fraction', '去心邻域内被取倒数的因子非零时改写成商，再检验未定式。');
edge('S.limit.inf_over_inf', 'M.squeeze_theorem', '同除主幂后若出现趋零因子与有界振荡因子的乘积，用统一绝对值界证明趋零。');
edge('S.deriv.higher_order', 'M.power_series_expansion', '在收敛半径内部，若已知展开系数，可由x^n项系数乘n!读取展开点的高阶导数。');
for (const sid of ['S.multivar.binary_limit', 'S.multivar.continuity']) edge(sid, 'M.continuity_rules', '目标点处连续且表达式有定义时，直接代入；遇到未定式须另行处理。');
edge('S.mvt.max_min_application', 'M.model_objective_function', '应用题先列出变量、约束、目标函数和区间，再求最值。');
edge('S.mvt.max_min_application', 'M.complete_square', '目标为二次式时先配方，并检查顶点是否位于允许区间。');
for (const sid of ['S.multiint.double_cartesian','S.multiint.polar']) edge(sid, 'M.partition_domain', '取整或分段表达式先按变化边界分区；坐标选择是后续独立决定。');

const polar = method('M.polar_transform');
polar.steps[4] = '二元极限令r→0时，须证明对所有允许θ一致趋于同一值；可用与θ无关且趋零的误差上界。只检查固定θ的射线不够。';
polar.preconditions[1] = '二元极限须控制所有允许方向：对θ一致趋近，不能只验证每条固定射线的极限相同。';
const polarWarning = '各条直线的极限相同仍可能沿弯曲路径不同，如x²y/(x⁴+y²)沿射线趋0、沿y=x²趋1/2。';
if (!polar.pitfalls.includes(polarWarning)) polar.pitfalls.push(polarWarning);
edge('S.multivar.binary_limit', 'M.polar_transform', '极坐标化归后，证明对θ一致趋于同一值；固定每个θ分别取极限不足以保证二重极限存在。');
const pf = method('M.partial_fraction');
pf.one_liner = '先做整式除法与实因式分解，将有理式拆成简单分式之和；可用于积分，也能简化高阶求导。';
pf.not_applicable[0] = '尚未完成实因式分解时先处理分母；x⁴+1可分成(x²+√2x+1)(x²−√2x+1)，不能称为不可分解。';
pf.steps[3] = '按当前任务处理简单项：积分时逐项积分；高阶求导时使用简单分式的幂函数导数，不执行积分步骤。';
const highest = method('M.divide_highest_power');
highest.not_applicable = highest.not_applicable.map(t => /振荡|sin|cos/.test(t) ? '含振荡因子时，同除主幂只能处理有理部分；须另证振荡因子有界或继续讨论，不能直接给振荡因子代极限。' : t);
const lhWarning = '导数之比没有极限，不能反推原商没有极限；洛必达是满足条件后的充分工具。';
if (!method('M.lhopital').pitfalls.includes(lhWarning)) method('M.lhopital').pitfalls.push(lhWarning);
scene('S.multivar.binary_limit').name = '二元函数极限';
scene('S.multivar.binary_limit').signals[3] = '直接代入先检查是否有定义；若得到0/0等未定式，再考虑路径、夹逼或极坐标。';
// Disabled source nodes remain documented, but active references cannot point to them.
const foundations = {
  'M.counterexample_sequences': '如果函数在该点有极限，沿任意定义域内趋近数列的函数值都须趋于同一个值。找到两列结果不同，就否定了这个必要条件。',
  'M.product_telescoping': '先建立有限乘积的精确恒等式，再对两边取极限。相消发生在有限项上，不使用未经证明的无限乘积运算法则。',
  'M.polynomial_division': '多项式恒等式P=Q·商+余式保证拆分没有改变原式；在Q非零处可以除以Q。余式次数小于Q，故在无穷远它们的比值趋零。',
  'M.finite_limit_constraint': '合并后若仍有非零的正次数多项式项，它在无穷远不可能趋于有限值；已证明趋零的余项也不能把它抵消。因此先消去增长项，再对照常数极限。',
  'M.pointwise_limit': '点态极限对每个固定x分别考察一列数。得到的极限函数是新的研究对象，它的连续性不能仅由原来各项连续推出。',
  'M.continuity_rules': '连续性的定义就是函数值与目标点极限相同。连续函数的和、积、合法商以及复合在满足定义域条件时仍连续。',
  'M.inverse_derivative': '对恒等关系f(g(y))=y用链式法则，得到f′(g(y))g′(y)=1；只有对应的f′非零，才可除过去。',
  'M.model_objective_function': '题设的几何或数量关系将允许方案转成变量区间上的函数值。每个变量值必须对应合法方案，才有资格比较最值。',
  'M.complete_square': '实数的平方非负。写成A(x-h)²+k后，A的符号决定顶点是最小还是最大；允许区间决定顶点能否被取到。',
  'M.combine_fractions': '在原分母非零处，通分是等式变形。它让差中可相消的项集中到同一分子，不自动保证极限的某种类型。',
  'M.rewrite_as_fraction': '在因子非零处，uv=u/(1/v)=v/(1/u)。这是恒等变形；新分子分母的趋势仍须分别检查。',
  'M.partition_domain': '可积函数在不重叠的分区上的积分可以相加。先用分区确定真实表达式，才能选择坐标和计算公式。',
};
for (const [id, principle] of Object.entries(foundations)) method(id).principle = principle;
for (const s of scenes()) s.distinguish_from = (s.distinguish_from ?? []).filter(d => d.scenario_id !== 'S.limit.parametric_limit');
for (const m of methods()) {
  const active = scenes().filter(s => s.id !== 'S.limit.parametric_limit' && s.methods.some(e => e.method_id === m.id));
  m.applies_to_scenarios = active.map(s => s.id);
  m.origin_block_ids ??= m.block_ids.length ? [...m.block_ids] : [Object.entries(files).find(([, f]) => f.methods?.includes(m))?.[1].block_id];
  m.block_ids = [...new Set(active.map(s => s.block_id))];
}
for (const [f, value] of Object.entries(files)) { await save(resolve(asset, f), value); await save(resolve(root, 'skeleton', f), value); }

const reviewDir = resolve(root, 'frontend/src/assets/practice/bank402');
const repaired = [];
for (const f of (await readdir(reviewDir)).filter(f => /^review-.*\.json$/.test(f))) {
  const path = resolve(reviewDir, f); await snapshot(path, `reviews/${f}`); const rows = await read(path);
  for (const r of rows) {
    const q = r.question; if (!q) continue;
    const id = r.originalId; let changed = false;
    const parameter = (symbols, role, domain, description) => ({ kind: 'parameter', symbols, role, domain, description });
    const overlays = { 6: [parameter(['a'], 'given', 'a>0', 'a是给定底数；a=1时商恒为零。')],
      13: [parameter(['a','b'], 'unknown', 'real', '题设整体极限为0，求实常数a和b。')],
      55: [parameter(['μ'], 'given', 'real', '一般实数幂先在x>0讨论，其余定义域须另外判断。')],
      57: [parameter(['a'], 'given', 'a>0且a≠1', '指数函数底数固定，不把a当作自变量。')],
      60: [parameter(['a'], 'given', 'a>0且a≠1', '对数的底数固定，x>0。')],
      93: [parameter(['a'], 'given', 'a>0', '铁丝总长固定，圆周长x的允许范围为0≤x≤a。')] };
    if (overlays[id]) q.overlays = overlays[id];
    const setEntrance = sid => { r.entranceScenarioId = q.entranceScenarioId = sid; for (const rt of q.routes) rt.steps[0].scenarioId = sid; };
    if (id === 1) { for (const rt of q.routes) rt.steps[0].methodId = 'M.counterexample_sequences'; changed = true; }
    if (id === 24) {
      setEntrance('S.limit.function_sequence_limit');
      for (const rt of q.routes) rt.steps[0].methodId = 'M.pointwise_limit';
      const main = q.routes.find(rt => rt.preferred); main.steps[2].methodId = 'M.continuity_rules'; changed = true;
    }
    if (id === 30) {
      for (const rt of q.routes) rt.steps[0].methodId = 'M.product_telescoping';
      const main = q.routes.find(rt => rt.preferred);
      main.steps = [
        { scenarioId: q.entranceScenarioId, methodId: 'M.product_telescoping', state: q.question,
          transformedState: String.raw`$P_n=\frac{\sin1}{2^n\sin(2^{-n})}$。先用二倍角公式对有限乘积逐项相消。`, condition: 'n为正整数，各角在(0,1)，相除的正弦非零。' },
        { scenarioId: 'S.limit.0over0', methodId: 'M.important_limit', state: String.raw`$2^n\sin(2^{-n})=\frac{\sin(2^{-n})}{2^{-n}}$`,
          transformedState: String.raw`$2^{-n}\to0$，分母趋于1，所以$P_n\to\sin1$。`, condition: '令u=2^{-n}，u趋于0，使用sin u/u趋于1。' },
      ]; changed = true;
    }
    if ([47,48,55,57,60].includes(id)) {
      setEntrance('S.deriv.basic_definition');
      for (const rt of q.routes) for (const st of rt.steps) if (st.methodId === 'M.derivative_definition') st.scenarioId = 'S.deriv.basic_definition';
      changed = true;
    }
    if (id === 58) { setEntrance('S.deriv.inverse'); for (const rt of q.routes) for (const st of rt.steps) if (st.methodId === 'M.chain_rule') { st.scenarioId = 'S.deriv.inverse'; st.methodId = 'M.inverse_derivative'; } changed = true; }
    if (id === 93) {
      for (const rt of q.routes) rt.steps[0].methodId = rt.id === 'r-alternative' ? 'M.monotonicity_analysis' : 'M.model_objective_function';
      q.routes.find(rt => rt.preferred).steps[1].methodId = 'M.complete_square'; changed = true;
    }
    if (id === 326) {
      const main = q.routes.find(rt => rt.preferred); main.steps[0].methodId = 'M.continuity_rules'; main.condition = main.steps[0].condition = '在(1,2)的足够小邻域内xy≠0，有理函数连续。';
      main.summary = '检查分母非零，用连续性直接代入得到3/2';
      q.routes.find(rt => rt.id === 'B').summary = '只沿y=2求极限，就断定所有路径的极限相同';
      q.routes.find(rt => rt.id === 'C').summary = '因为别处xy可以为零，就断定(1,2)处极限不存在'; changed = true;
    }
    if (id === 21) {
      const main = q.routes.find(rt => rt.preferred), old = main.steps[0];
      main.steps = [{ ...old, transformedState: '有理因子(x³−2x+5)/(3x⁵+2x+3)同除x⁵，趋于0。', condition: 'x趋于无穷，分母在足够远处非零；最高次数5大于3。' },
        { scenarioId: 'S.limit.bounded_times_zero', methodId: 'M.squeeze_theorem', state: '趋零的有理因子乘(2+cos x−sin x)', transformedState: '由|2+cos x−sin x|≤4，乘积绝对值≤4倍有理因子的绝对值，故趋于0。', condition: '上界4对所有实x成立，不需要sin x或cos x各自有极限。' }]; changed = true;
    }
    if (id === 13) { setEntrance('S.limit.growth_balance'); for (const rt of q.routes) if (rt.valid) rt.steps[0].methodId = 'M.finite_limit_constraint'; changed = true; }
    if ([59,97].includes(id)) { const alternate=q.routes.find(rt=>rt.id==='r-alternative'); if(alternate) alternate.steps[0].methodId='M.power_series_expansion'; changed=true; }
    if (id === 347) { for(const rt of q.routes) rt.steps[0].methodId='M.partition_domain'; changed=true; }
    if (changed) {
      q.metadata.contentVersion = 2;
      q.metadata.semanticReview = { status: 'rechecked', version: 2, scope: ['answer','route','labels'],
        evidence: [`审查输出/题目语义复核.jsonl#question.${id}`, '本轮核对实际变形、定义域及方法标签；旧历史不回写。'] };
      if (!r.classificationReason.includes('知识网络v2')) r.classificationReason += '；知识网络v2按实际操作修订步骤标签。'; repaired.push(id);
    }
    if (changed || overlays[id]) {
      q.task = id === 93 ? ['compute'] : suggestTasks(q.question);
      q.classificationReview = { status: 'rechecked', needsReview: false, overlaysComplete: true,
        basis: '本轮逐题核对题面所问；步骤标签的审核范围单独记录在semanticReview。' };
      q.classificationReview.overlaysComplete = Boolean(overlays[id]);
    }
  }
  await save(path, rows);
}
await snapshot(resolve(root, 'frontend/src/assets/practice/question-banks/bank402.json'), 'bank402.json');
await save(resolve(archive, '迁移记录.json'), { version: 2, repairedQuestionIds: repaired.sort((a,b)=>a-b), activeScenarios: scenes().length - 1, methods: methods().length,
  historicalLearnerDataModified: false, originalInputModified: false });
console.log(JSON.stringify({ repairedQuestionIds: repaired, scenarios: scenes().length - 1, methods: methods().length }));
