import { patternsForScenario } from '../knowledge/patterns.js';

// These explanations supplement the supplied classification. They do not add
// scenarios, invent textbook quotations, or change scenario-method edges.
const groupDefinitions = {
  'G.limit.indeterminate': '未定式是指：只知道各部分趋近于什么，还不足以确定整个式子的极限。比如同为趋于零的分子和分母，谁变小得更快会影响结果。常见形式有 $0/0$、$\\infty/\\infty$、$0\\cdot\\infty$、$\\infty-\\infty$、$1^\\infty$、$0^0$、$\\infty^0$。它们是趋近状态的描述，不能当作普通数值运算。',
  'G.limit.sequence': '数列极限研究当项数越来越大时，数列的值是否越来越接近一个固定数。递推关系、每项结构以及上下界，决定怎样把这种趋势证明出来。',
  'G.limit.infinitesimal': '无穷小是指在指定极限过程中趋于零的量。比较它们的阶，就是比较谁趋于零更快：通过两者的比值判断，而不是只看它们都等于零。',
  'G.limit.continuity': '连续性要同时检查函数值、附近的极限，以及二者是否一致。间断点分类进一步区分极限不存在、左右极限不同，或极限存在却和函数值不一致的情形。',
  'G.limit.epsilon': '极限的严格证明把“足够接近”写成可检验的不等式：给定任意误差，找出足够小的邻域或足够大的项数，让函数值一直落在误差范围内。',
  'G.deriv.rules': '求导规则把复杂函数的变化率拆成可处理的部分。先识别显式复合、隐式关系、参数关系或幂指结构，再决定怎样组织求导。',
  'G.deriv.differentiability': '可导性讨论某点的增量比有没有确定极限。抽象函数题往往不能直接套初等公式，需要把题目条件转成导数定义或局部展开。',
  'G.deriv.higher': '高阶导数是对导函数继续求导。训练重点是识别重复结构、乘积规律或通项，避免只靠机械地连续求导。',
  'G.deriv.application': '导数不仅用来求公式，还描述局部变化率、切线方向和一阶近似。需要先明确是在求几何对象，还是在估计小变化。',
  'G.mvt.mean_value': '中值定理把区间上的整体变化与内部某点的导数联系起来。证明题中先检查连续、可导和端点条件，再构造适合使用定理的函数。',
  'G.mvt.inequality_root': '不等式与方程根问题常通过单调性、极值、零点存在定理或中值定理转化。证明存在、证明唯一、求出数值是不同目标。',
  'G.mvt.behavior': '函数性态包括单调、极值、凹凸、拐点、渐近趋势和曲率。导数给出局部信息，完整结论还要结合定义域、边界和特殊点。',
  'G.mvt.extremum_app': '最值应用先把实际限制写成变量范围和目标函数，再比较内部临界点与边界。局部极值不自动等于实际问题的最大值或最小值。',
  'G.indefint.basic_substitution': '不定积分是在寻找导数等于被积函数的原函数。能直接识别基本公式时直接积分；复合结构可尝试换元，把内层函数变成新变量。',
  'G.indefint.by_type': '有理函数、三角有理式等结构，各有把式子化简为基本积分的办法。分类的作用是缩小尝试范围，而不是看到函数名就机械选一种方法。',
  'G.indefint.by_parts': '分部积分把一个积分换成另一个积分。选择哪部分求导、哪部分积分，应让新积分更简单，或产生可解的循环关系。',
  'G.indefint.recurrence': '递推型积分把带参数或次数的积分，与次数更低的同类积分联系起来。关系式需要配合起始值，并检查适用的参数范围。',
  'G.defint.calculation': '定积分给出一个确定的累计量。除寻找原函数外，还可以利用对称性、分段、换元和变限积分的结构来简化计算。',
  'G.defint.improper': '反常积分把无穷区间或无界被积函数的积分定义为极限。先判断这些极限是否存在，不能直接跨越奇点套用普通定积分公式。',
  'G.defint.proof': '积分证明关注函数的大小、平均值和累计关系。常把点上的不等式积分，或检查积分中值定理等工具的条件。',
  'G.defint.element_method': '微元法先用一个很小的部分近似描述总量，再把这些部分累加为积分。关键是选择变量并正确表达小面积、小体积或小质量。',
  'G.defint.riemann': '黎曼和把分割区间上的“函数值乘小区间长度”累加起来。当分割越来越细，这种和在适当条件下趋于定积分。',
  'G.ode.first_order': '一阶微分方程只含未知函数及其一阶导数。先识别可分离、齐次、线性或伯努利结构，再选择相应变换；特殊解与初始条件也要检查。',
  'G.ode.higher_order': '高阶方程含二阶或更高导数。能降阶时先减少未知层数；常系数线性方程则利用特征方程、通解和特解的结构。',
  'G.ode.reverse_apply': '微分方程既可从变化规律建立模型，也可从一族解反推方程。建模要明确变量、变化率、适用范围和初始条件。',
  'G.vecalg.vector': '向量的数量积、向量积和混合积分别联系夹角与投影、法向与面积、共面与体积。运算的结果类型和几何含义决定该选哪一种。',
  'G.vecalg.plane_line': '空间平面常由法向量描述，直线常由方向向量描述。位置、距离和夹角问题，可以转化为这些向量的关系。',
  'G.vecalg.surface': '曲面的方程来自点的几何约束。旋转、平移或直母线运动等结构，帮助把几何描述转成坐标关系。',
  'G.vecalg.projection': '曲线投影讨论一条空间曲线在坐标平面上的影子。消去相应坐标时，还要保留原方程对其他坐标的取值限制。',
  'G.multivar.limit_continuity': '多元极限要求从定义域内所有允许路径趋近时，函数都靠近同一值。两条路径结果不同可以否定极限；有限条路径相同不能证明极限存在。',
  'G.multivar.derivative': '偏导数只考察一个变量方向，全微分考察整体的一阶变化。复合、隐式、方向导数和梯度，把这些局部变化组织成不同形式。',
  'G.multivar.geometry': '空间曲线的导数给出切向，曲面的梯度在适当正则条件下给出法向。要先检查向量非零，再写切线或切平面。',
  'G.multivar.extremum': '多元最值要区别无约束、带约束和闭区域问题。临界点只是候选，边界、约束的特殊点以及充分条件也会影响结论。',
  'G.multiint.double': '二重积分在平面区域上累计函数值。选择积分次序或极坐标，目的是让区域的边界和被积函数更容易表达。',
  'G.multiint.triple': '三重积分在空间区域上累计函数值。直角、柱、球坐标适合不同对称结构；换坐标必须同时改变区域和体积微元。',
  'G.multiint.application': '重积分可计算面积、体积、质量、质心等量。需要把几何区域和密度或目标量一起表达清楚，单位也应一致。',
  'G.line_surface.curve': '曲线积分沿一条曲线累计。第一类以弧长为微元；第二类与方向有关。参数化与积分定理的选择取决于曲线和场的条件。',
  'G.line_surface.surface': '曲面积分在一个曲面上累计。第一类使用面积微元，第二类描述通量并依赖定向；投影或积分定理必须处理法向和边界。',
  'G.line_surface.field': '散度描述场在一点附近的净流出趋势，旋度描述局部旋转趋势。它们把局部微分量与整体积分定理联系起来。',
  'G.series.constant': '常数项级数的收敛，是指部分和趋于有限值。通项趋于零只是必要条件；正项、交错以及一般有符号级数需要不同判别。',
  'G.series.power': '幂级数由带变量的无穷多项组成。先找收敛半径，再单独检查端点；逐项操作与函数展开还要满足相应条件。',
  'G.series.fourier': '傅里叶级数把周期函数表示成正弦、余弦的组合。系数依赖周期和奇偶性；在间断点处的收敛值需要单独理解。',
};

const sources = {
  limits: { title: 'OpenStax · Calculus Volume 1 · 2.3 极限法则', url: 'https://openstax.org/books/calculus-volume-1/pages/2-3-the-limit-laws' },
  lhopital: { title: 'OpenStax · Calculus Volume 1 · 4.8 洛必达法则', url: 'https://openstax.org/books/calculus-volume-1/pages/4-8-lhopitals-rule' },
  chain: { title: 'OpenStax · Calculus Volume 1 · 3.6 链式法则', url: 'https://openstax.org/books/calculus-volume-1/pages/3-6-the-chain-rule' },
  parts: { title: 'OpenStax · Calculus Volume 2 · 3.1 分部积分', url: 'https://openstax.org/books/calculus-volume-2/pages/3-1-integration-by-parts' },
  taylor: { title: 'OpenStax · Calculus Volume 2 · 6.3 泰勒展开与余项', url: 'https://openstax.org/books/calculus-volume-2/pages/6-3-taylor-and-maclaurin-series' },
};

const principles = {
  'M.equiv_infinitesimal': { principle: '等价指 $\\lim f/g=1$。在乘除结构中换掉一个因子，相当于给整个式子乘上一个趋于 $1$ 的比值。相减时若主项抵消，误差反而可能成为决定结果的部分，所以需要保留足够高阶。', basis: '等价关系的定义与极限乘法法则。' },
  'M.factor_cancel': { principle: '极限考察趋近点附近的行为。在去心邻域里，只要约去的因子不为零，约分前后两式相等，因此极限相同。约分不会替原函数补上趋近点处的函数值。', basis: '去心邻域内相等的函数具有相同极限。', source: sources.limits },
  'M.rationalization': { principle: '平方差恒等式 $(a-b)(a+b)=a^2-b^2$ 把根式差转成更容易化简的式子。分子分母同步乘共轭并检查它在附近不为零，才能保持等价。', basis: '平方差恒等式与极限法则。', source: sources.limits },
  'M.squeeze_theorem': { principle: '若在目标点附近 $a(x)\\le f(x)\\le b(x)$，且两端都趋于同一个 $L$，中间的量只能趋于 $L$。两端极限不同，就还不能确定中间极限。', basis: '夹逼准则。', source: sources.limits },
  'M.lhopital': { principle: '洛必达法则通过导数之比判断函数之比的极限。使用前须检查 $0/0$ 或 $\\infty/\\infty$ 型、相应去心区间内可导、分母导数非零，并且导数之比的极限存在（可为无穷）。重新使用时也要再次核对条件。', basis: '洛必达法则的条件及结论；不是对整个分式求导。', source: sources.lhopital },
  'M.taylor_expansion': { principle: '用多项式描述函数在展开点附近的变化，并用余项控制遗漏的信息。例如 $e^x=1+x+x^2/2+o(x^2)$；若常数项、一次项抵消，二次项就决定后续判断。展开到几阶，应由所需精度和抵消结构决定。', basis: '泰勒公式与余项；满足相应阶数的可导条件。', source: sources.taylor },
  'M.chain_rule': { principle: '复合变化分两层：内层先变化，外层再响应。当两层在相应点可导，$\\frac{d}{dx}f(g(x))=f\'(g(x))g\'(x)$。层数更多时逐层相乘，不能漏掉内层导数。', basis: '链式法则。', source: sources.chain },
  'M.integration_by_parts': { principle: '从乘积求导 $(uv)\'=u\'v+uv\'$ 两边积分，再移项得到 $\\int u\\,dv=uv-\\int v\\,du$。选择 $u$ 和 $dv$ 是为了让新积分更简单；定积分还要保留端点项。', basis: '乘积求导法则与分部积分公式；通常要求相关函数及导数满足积分条件。', source: sources.parts },
  'M.derivative_definition': { principle: '导数是局部增量比的极限：$f\'(a)=\\lim_{h\\to0}\\frac{f(a+h)-f(a)}{h}$。识别这个结构时，要确保分子的增量和分母的自变量增量对应，并检查左右极限。', basis: '导数定义。' },
  'M.log_transform': { principle: '对正值的幂指表达式 $y=u^v$，有 $\\ln y=v\\ln u$，把指数关系变成乘积。先求这个新表达式的极限，再利用指数函数的连续性还原；不能先假设原极限存在。', basis: '对数恒等式、正值条件及指数函数的连续性。' },
  'M.divide_highest_power': { principle: '分子分母同除一个在附近不为零的主导幂，把低阶项变成趋于零的量。要比较实际增长阶；含根式时需注意 $\\sqrt{x^2}=|x|$，不能忽略趋近方向。', basis: '恒等变形、极限法则和增长阶比较。' },
  'M.one_sided_limit': { principle: '在点的两侧都可趋近时，有限双侧极限存在，当且仅当左右极限存在且相等。连续还要求这个共同值等于函数在该点的值；分支不同应分别计算。', basis: '双侧极限与单侧极限的关系、连续定义。' },
  'M.first_substitution': { principle: '链式法则的逆用：若 $F\'=f$，则 $(F(\\varphi(x)))\'=f(\\varphi(x))\\varphi\'(x)$。因此识别内层结构时，也必须同步找到它的导数因子。', basis: '链式法则与原函数定义。', source: sources.chain },
  'M.integration_by_substitution': { principle: '换元同时改变函数表达式和微分。令 $x=\\varphi(t)$ 时，$dx=\\varphi\'(t)dt$；定积分还需变换上下限，并按实际区间检查换元的有效性。', basis: '链式法则与积分换元公式。' },
  'M.newton_leibniz': { principle: '若 $f$ 在 $[a,b]$ 连续，且 $F\'=f$，则 $\\int_a^b f(x)dx=F(b)-F(a)$。原函数联系局部变化率与整体累计量；含内部奇点时要先按反常积分处理。', basis: '微积分基本定理。' },
  'M.variable_limit_integral': { principle: '连续的被积函数产生变上限积分 $F(x)=\\int_a^x f(t)dt$，满足 $F\'(x)=f(x)$。若上限是 $g(x)$，再乘 $g\'(x)$；上下限都变时分别求导并作差。', basis: '微积分基本定理与链式法则。' },
  'M.partial_fraction': { principle: '先把有理式化成真分式，再依据分母的因式结构分解。待定系数通过恒等关系确定；重因子需要保留全部相应幂次，而不是只写一次。', basis: '多项式恒等式与有理函数分解。' },
  'M.path_approach': { principle: '多元极限存在必须对所有允许路径给出同一个结果。找出两条结果不同的路径即可否定；检查几条路径都相同，只能说明暂时没有找到反例。', basis: '多元极限定义的所有路径要求。' },
  'M.monotone_bounded': { principle: '递增数列有上界，或递减数列有下界，就收敛到有限极限。递推关系中的固定点只是极限的候选；必须先证明数列确实收敛，才可合法地对递推式取极限。', basis: '单调有界数列收敛定理与连续性。' },
  'M.important_limit': { principle: '标准结构是 $\\lim_{u\\to0}\\sin u/u=1$（角度用弧度），以及 $\\lim_{t\\to+\\infty}(1+1/t)^t=e$。换元的作用是把题目改写成这些结构，同时保留额外系数和指数。', basis: '两个重要极限及极限法则；新变量必须满足对应的趋近过程。' },
  'M.implicit_differentiation': { principle: '方程中的 $y$ 也随 $x$ 变化，因此 $y$ 的函数求导时要乘 $y\'$。对 $F(x,y)=0$ 求导得到 $F_x+F_yy\'=0$；在相应光滑与 $F_y\\ne0$ 条件下可解出 $y\'=-F_x/F_y$。', basis: '链式法则与隐函数的局部正则条件。', source: sources.chain },
  'M.parametric_differentiation': { principle: '参数 $t$ 同时推动 $x$ 与 $y$ 变化。当 $dx/dt\\ne0$ 时，$dy/dx=(dy/dt)/(dx/dt)$。再求高阶导数时，仍需先对 $t$ 求导，然后除以 $dx/dt$。', basis: '链式法则；参数导数不能直接当成对自变量的导数。', source: sources.chain },
  'M.logarithmic_differentiation': { principle: '先把幂指、连乘或连除写成对数的和差，再求导。正值函数可用 $\\ln y$；非零且符号固定时可用 $\\ln|y|$，求导为 $y\'/y$。最后乘回 $y$，不能把对数导数当成原导数。', basis: '对数恒等式与链式法则。', source: sources.chain },
  'M.rolle_theorem': { principle: '若函数在闭区间连续、开区间可导，并且两个端点函数值相等，那么内部至少有一点导数为零。构造辅助函数时，就是设法让这三个条件同时成立。', basis: '罗尔定理；端点相等不能代替连续与可导条件。' },
  'M.lagrange_mvt': { principle: '若函数在闭区间连续、开区间可导，区间内至少一点的瞬时变化率等于整体平均变化率：$f\'(\\xi)=(f(b)-f(a))/(b-a)$。存在性结论不意味着这点唯一。', basis: '拉格朗日中值定理。' },
  'M.cauchy_mvt': { principle: '两函数在闭区间连续、开区间可导时，内部存在一点满足 $[f(b)-f(a)]g\'(\\xi)=[g(b)-g(a)]f\'(\\xi)$。要写成两个比值相等，还需检查相应分母非零。', basis: '柯西中值定理；交叉相乘形式能避免遗漏除法条件。' },
  'M.symmetry': { principle: '要同时检查积分区域和被积函数。对称区间上的可积奇函数积分为零，可积偶函数积分可化为半区间的两倍；只有区域对称，或只有函数有奇偶性，都不够。', basis: '积分换元与奇偶性；多重积分中同样需保持区域与变换一致。' },
  'M.zero_point_theorem': { principle: '连续函数在区间两端一正一负，就必须在中间经过零点。这保证至少存在一个根；唯一性还需要单调性或其他额外论证。', basis: '连续函数的介值性质。' },
  'M.ratio_test': { principle: '对级数考察相邻项绝对值之比的极限 $L$：$L<1$ 时绝对收敛，$L>1$ 时发散，$L=1$ 时本判别法无法决定。使用前要确认相邻比有意义并满足所用形式的条件。', basis: '比值判别法；不能把 $L=1$ 当作发散结论。' },
  'M.root_test': { principle: '对级数考察第 $n$ 项绝对值的 $n$ 次方根的极限 $L$：$L<1$ 时绝对收敛，$L>1$ 时发散，$L=1$ 时无法由本法判断。它适合带整体 $n$ 次幂的结构。', basis: '根值判别法。' },
  'M.leibniz_test': { principle: '交错级数的正项幅值单调递减并趋于零时，级数收敛。这个结论本身不保证绝对收敛；判断绝对收敛要另看取绝对值后的级数。', basis: '莱布尼茨交错级数判别法；也可从足够大的项数起满足条件。' },
};

const scenarioSupplements = {
  'S.limit.0over0': { examples: ['$\\lim_{x\\to0}\\frac{\\sin x}{x}$', '$\\lim_{x\\to0}\\frac{e^x-1-x}{x^2}$'], note: '$0/0$ 只说明直接代入不能决定结果。$x/x$、$x^2/x$ 和 $x/x^2$ 在同一趋近过程中也会给出不同结果；方法要结合实际结构选择。' },
  'S.limit.inf_over_inf': { examples: ['$\\lim_{x\\to+\\infty}\\frac{3x^3-2x+1}{2x^3+x^2}$', '$\\lim_{x\\to+\\infty}\\frac{\\ln x}{x}$'], note: '这里的无穷大是增长趋势。两个量都无界，不代表比值为 $1$；须比较增长速度与趋近方向。' },
  'S.limit.zero_times_inf': { examples: ['$\\lim_{x\\to0^+}x\\ln x$'], note: '一个因子趋零、另一个无界，结果取决于它们的速度。先改写成商式，可能转成新的 $0/0$ 或 $\\infty/\\infty$ 情景。' },
  'S.limit.inf_minus_inf': { examples: ['$\\lim_{x\\to+\\infty}(\\sqrt{x^2+x}-x)$'], note: '两个无界量相减，不能拆开成两个普通实数极限相减。通分、有理化或提取主项后，才可能看清抵消后的部分。' },
  'S.limit.one_to_inf': { examples: ['$\\lim_{x\\to0}(\\cos x)^{1/x^2}$'], note: '底数趋于 $1$、指数无界，微小偏离被不断放大。正值条件下取对数，可把它转为乘积或商式，再判断新情景。' },
  'S.limit.power_indeterminate': { examples: ['$\\lim_{x\\to0^+}x^x$', '$\\lim_{n\\to\\infty}n^{1/n}$'], note: '记号 $0^0$ 或 $\\infty^0$ 描述各部分的极限状态，不是幂运算的最终结果。取对数前要检查底数在考虑的区间内为正。' },
  'S.deriv.composite_derivative': { boundaries: [{ scenarioId: 'S.deriv.power_exponential', how: '幂指式也可以先写成指数与对数的复合函数，再使用链式法则；不能把变动的指数误当常数直接套幂函数求导公式。' }, { scenarioId: 'S.deriv.implicit_derivative', how: '显式复合结构已给出函数表达式；隐式关系则在方程中把未知函数随自变量的变化一并处理。' }] },
};

export function methodLearningContent(method) {
  const extra = principles[method.id] ?? {};
  return {
    definition: method.definition || method.one_liner || '先识别题目的结构，再核对这个方法的使用条件。',
    principle: extra.principle || method.principle || '', basis: extra.basis || method.basis || '', source: extra.source || null,
    conditions: method.preconditions ?? [], pitfalls: method.pitfalls ?? [],
    signals: (method.triggers ?? []).filter((signal) => signal !== method.one_liner && signal !== method.definition),
    examples: method.example_problems ?? [],
    steps: method.steps ?? [], limitations: method.not_applicable ?? [],
  };
}

export function scenarioLearningContent(scenario) {
  const extra = scenarioSupplements[scenario.id] ?? {};
  return { definition: scenario.definition, signals: scenario.signals ?? [],
    examples: extra.examples ?? scenario.recognition_examples ?? [], note: extra.note ?? '',
    boundaries: extra.boundaries ?? (scenario.distinguish_from ?? []).map((entry) => ({ scenarioId: entry.scenario_id, how: entry.how })) };
}

export function getKnowledgeNode(skeleton, nodeRef) {
  if (!nodeRef || !['scenario', 'group', 'block'].includes(nodeRef.kind)) return null;
  const { id, kind } = nodeRef;
  if (kind === 'scenario') {
    const node = skeleton.scenarioById.get(id);
    if (!node) return null;
    const learning = scenarioLearningContent(node);
    const group = skeleton.groups?.find((entry) => entry.scenario_ids.includes(id));
    return { ...node, ...learning, kind, patterns: patternsForScenario(skeleton, node.id),
      boundaries: learning.boundaries
        .map((entry) => ({ ...entry, name: skeleton.scenarioById.get(entry.scenarioId)?.name })).filter((entry) => entry.name),
      group: group && { id: group.id, kind: 'group', name: group.name },
      parent: { id: node.block_id, kind: 'block', name: skeleton.blockById.get(node.block_id)?.name },
      methods: node.methods.map((edge) => ({ ...skeleton.methodById.get(edge.method_id), condition: edge.when_to_prefer, priority: edge.priority })), children: [] };
  }
  const node = kind === 'block' ? skeleton.blockById.get(id) : skeleton.groups?.find((entry) => entry.id === id);
  if (!node) return null;
  const scenarioIds = kind === 'block' ? skeleton.scenariosForBlock(id).map((scenario) => scenario.id) : node.scenario_ids;
  const children = scenarioIds.map((scenarioId) => skeleton.scenarioById.get(scenarioId)).filter(Boolean);
  return { ...node, kind, definition: kind === 'block' ? node.summary : groupDefinitions[id] || `这一组把${children.map((entry) => entry.name).join('、')}放在一起；具体判断仍需查看各情景的定义和条件。`,
    signals: [], examples: [], note: '', boundaries: [], methods: [], children,
    parent: kind === 'group' ? { id: node.block_id, kind: 'block', name: skeleton.blockById.get(node.block_id)?.name } : null };
}

// The source skeleton uses human-readable Unicode math. Convert its isolated
// mathematical fragments for KaTeX while keeping surrounding Chinese prose.
export function knowledgeMarkdown(value) {
  const text = String(value ?? '');
  if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) return text;
  return text.split(/([\u3400-\u9fff，。；：！？]+)/u).map((fragment) => {
    if (/^[\u3400-\u9fff，。；：！？]+$/u.test(fragment) || !/[=→∫∞√²³ⁿ]|\blim\b|\b(?:sin|cos|tan|ln|arctan)\b/.test(fragment)) return fragment;
    const leading = fragment.match(/^\s*/u)?.[0] ?? '', trailing = fragment.match(/\s*$/u)?.[0] ?? '';
    const math = fragment.trim().replace(/→/gu, '\\to ').replace(/∞/gu, '\\infty ').replace(/∫/gu, '\\int ').replace(/□/gu, '\\square ').replace(/½/gu, '\\tfrac{1}{2}')
      .replace(/[−–]/gu, '-').replace(/·/gu, '\\cdot ').replace(/²/gu, '^{2}').replace(/³/gu, '^{3}').replace(/ⁿ/gu, '^{n}')
      .replace(/√\(([^()]*)\)/gu, '\\sqrt{$1}').replace(/√([a-zA-Z0-9])/gu, '\\sqrt{$1}')
      .replace(/\b(lim|sin|cos|tan|cot|ln|arcsin|arccos|arctan)(?=[^a-zA-Z]|$)/gu, '\\$1 ');
    return `${leading}$${math}$${trailing}`;
  }).join('');
}
