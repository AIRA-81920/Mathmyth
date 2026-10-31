// Small, explicit learning relationships. Every result below is derived by an
// exact identity before taking a limit; the tests also check both sides
// numerically. These are self-authored worked examples, not textbook classics.
const s = String.raw;
const ZERO = 'S.limit.0over0';
const RATIONAL = 'M.rationalization', IMPORTANT = 'M.important_limit', LH = 'M.lhopital', FACTOR = 'M.factor_cancel';
const V = { op: 'var' }, C = { op: 'const' };
const op = (name, ...args) => ({ op: name, args });
const step = (methodId, state, transformedState, condition) => ({ scenarioId: ZERO, methodId, state, transformedState, condition });
const route = (id, summary, steps, reason, preferred = false) => ({ id, summary, steps, reason, preferred, valid: true,
  condition: steps.map(item => item.condition).join('；') });
const invalid = (methodId, state, reason) => ({ ...route('r-direct-substitution', '分子分母都代入零，直接把 0/0 当成零',
  [step(methodId, state, '0/0 不是一个数值，不能作为计算结果。', '分母趋于零，直接代入的商法则不适用。')], reason), valid: false, failedStep: 0 });
const coefficient = n => n === 1 ? '' : String(n);
const fraction = (a, b) => {
  function gcd(x, y) { while (y) [x, y] = [y, x % y]; return x; }
  const g = gcd(a, b); a /= g; b /= g;
  return b === 1 ? String(a) : s`\frac{${a}}{${b}}`;
};
const rootGoal = '根式差有理化后，认出并整理三角函数重要极限';
const rootLinearGoal = '用共轭式消去根式差，再检查剩余分母';
const sineGoal = '凑出正弦重要极限，并保留内外常数因子';
const factorGoal = '分解平方差，在去心邻域约去公共零因子';

function question({ id, familyId, goal, body, solution, routes, structure, hints, relation = 'similar', changedCondition = '', check }) {
  return { format: 'route-v1', entranceScenarioId: ZERO, selectionMode: 'single', question: body, solution, routes,
    structure, variables: ['x'], comparisonCriterion: '优先用恒等变形看清结构，减少求导次数', task: ['compute'], overlays: [],
    classificationReview: { status: 'declared', needsReview: false, overlaysComplete: true, basis: '题目、条件和关系随独立推导逐项核对。' },
    metadata: { motherId: `related.v4.${id}`, trainingGoal: goal, contentVersion: 1, reviewStatus: 'worked_example_checked', userApprovedClassic: false,
      source: { kind: 'self_authored', label: 'Mathmyth 4.0.0 自编关系样题', reference: 'related-bank.js：恒等变形、适用条件与双侧行为核对' },
      invariants: ['所给极限过程与定义域完整', '每条正确路线独立成立', '0/0 只表示未定式'],
      allowedVariations: [changedCondition || '改变正的常数系数，保留具体结构与有序方法链'],
      answerAudit: { method: '先恒等化简；逐项核对重要极限和洛必达条件；用两侧数值序列辅助检查', check },
      learning: { version: 1, familyId, goalId: `${familyId}.${relation === 'contrast' ? 'conditions' : relation === 'transfer' ? 'recognition' : 'key-step'}`, goal, targetLabel: goal, relation, hints,
        hintSteps: routes[0].steps.map(item => item.methodId), preferredRouteId: routes[0].id, changedCondition,
        verification: { status: 'worked_example_checked', kind: 'independent_derivation', reference: `related-bank.js#related.v4.${id}` },
        nextRelations: relation === 'similar' ? ['contrast', 'transfer'] : relation === 'contrast' ? ['transfer'] : [],
      },
    } };
}

function root(k, b, { sine = true, variant = 'normal' } = {}) {
  const familyId = sine ? 'limit.root-sine' : 'limit.root-linear';
  const input = sine ? s`\sin(${coefficient(k)}x)` : s`${coefficient(k)}x`;
  const radical = s`\sqrt{1+${input}}`, difference = s`${radical}-1`;
  const inverse = variant === 'inverse', contrast = variant === 'contrast';
  const divisor = contrast ? `${coefficient(b)}x^2` : `${coefficient(b)}x`;
  const expression = inverse ? s`\frac{${coefficient(b)}x}{${difference}}` : s`\frac{${difference}}{${divisor}}`;
  const rationalized = inverse ? s`\frac{${coefficient(b)}x(${radical}+1)}{${input}}`
    : s`\frac{${input}}{${divisor}(${radical}+1)}`;
  const standard = inverse ? s`\frac{x}{\sin(${coefficient(k)}x)}\,${b}(${radical}+1)`
    : contrast ? s`\frac{\sin(${coefficient(k)}x)}{${coefficient(k)}x}\cdot\frac{${k}}{${coefficient(b)}x(${radical}+1)}`
      : s`\frac{\sin(${coefficient(k)}x)}{${coefficient(k)}x}\cdot\frac{${k}}{${b}(${radical}+1)}`;
  const linearFinal = inverse ? s`\frac{${b}(${radical}+1)}{${k}}`
    : contrast ? s`\frac{${k}}{${coefficient(b)}x(${radical}+1)}` : s`\frac{${k}}{${b}(${radical}+1)}`;
  const answer = inverse ? fraction(2 * b, k) : fraction(k, 2 * b);
  const end = contrast ? s`$x\to0^+$ 时趋于 $+\infty$，$x\to0^-$ 时趋于 $-\infty$，双侧极限不存在。` : s`极限为 $${answer}$。`;
  const domain = sine ? 'x 趋于0时，1+sin(kx)趋于1，在充分小邻域根式有定义；共轭和趋于2且非零。'
    : 'x 趋于0时，1+kx趋于1，充分小邻域内为正；共轭和趋于2且非零。';
  const first = step(RATIONAL, `$${expression}$`, `$${rationalized}$`, domain + (inverse ? '正系数保证去心邻域分母不为零。' : 'x≠0，可以使用商式。'));
  const mainSteps = sine ? [first, step(IMPORTANT, `$${rationalized}$`, `$${standard}$；${end}`,
    contrast ? '令u=kx→0，sin(u)/u→1；仍有1/x因子，须分别检查左右符号。' : inverse
      ? '令u=kx→0，sin(u)/u→1，因此x/sin(kx)→1/k；不能丢掉外面的b。' : '令u=kx→0，sin(u)/u→1，分母的b与内层k必须保留。')]
    : [{ ...first, transformedState: `$${linearFinal}$；${end}` }];
  const derivativeTop = sine ? s`${k}\cos(${coefficient(k)}x)/(2${radical})` : s`${k}/(2${radical})`;
  const derivativeRatio = inverse ? s`${b}/(${derivativeTop})` : contrast ? s`(${derivativeTop})/(${2 * b}x)` : s`(${derivativeTop})/${b}`;
  const routes = [
    route('r-conjugate-chain', sine ? '先有理化，再整理正弦重要极限并检查剩余因子' : '先有理化，约去公共因子，再检查剩余分母', mainSteps,
      contrast ? '有理化没有消去全部趋零因子；两侧符号不同，不能把上题的有限结果照搬。' : '共轭式恒等变形后，每个趋零比值与常数因子都保留下来。', true),
    route('r-lhopital', contrast ? '两侧分别使用洛必达，检查导后商的符号' : '核对 0/0 与可导条件，用一次洛必达',
      [step(LH, `$${expression}$`, `$${derivativeRatio}$；${end}`,
        contrast ? '每一侧都是0/0；根式在充分小邻域可导，分母导数2bx在每侧非零；导后商分别趋于正负无穷。'
          : '为0/0型；充分小邻域分子分母可导，分母导数非零，导后商具有所示有限极限。')], '这是独立正确的替代解法；是否沿用目标思路与数学正确性分别记录。'),
    invalid(RATIONAL, `$${expression}$`, '分子分母都趋于零，只能说明是未定式；需要变形后才能判断。'),
  ];
  const inputTree = sine ? op('sin', op('multiply', C, V)) : op('multiply', C, V);
  const diffTree = op('subtract', op('sqrt', op('add', C, inputTree)), C);
  const structure = inverse ? op('divide', op('multiply', C, V), diffTree) : op('divide', diffTree, contrast ? op('multiply', C, op('power', V, C)) : op('multiply', C, V));
  const goal = contrast ? '有理化后检查剩余的趋零因子，并区分左右极限' : sine ? rootGoal : rootLinearGoal;
  return question({ id: `${sine ? 'root-sine' : 'root-linear'}.${variant}.${k}.${b}`, familyId, goal,
    body: s`求 $\displaystyle\lim_{x\to0}${expression}$。`,
    solution: s`在去心邻域同乘共轭式，得到 $${rationalized}$。${sine ? s`整理为 $${standard}$，其中 $\sin(${coefficient(k)}x)/(${coefficient(k)}x)\to1$。` : s`约去公共因子后为 $${linearFinal}$。`}${end}`,
    routes, structure, relation: inverse ? 'transfer' : contrast ? 'contrast' : 'similar',
    changedCondition: inverse ? '根式差移到分母，保留共轭与后续极限判断的目标。' : contrast ? '分母从一次趋零改为二次趋零；不再沿用有限常数结论。' : '',
    hints: [inverse ? '根式差出现在分母。可以同乘共轭式，把分母化简，再检查新的比值。' : '先观察分子的根式差。试着同乘共轭式，把它变成容易处理的分子。',
      contrast ? s`同乘共轭式后得到 $${rationalized}$。${sine ? '重要极限只能处理正弦比值；' : ''}检查分母是否还剩一个趋于零的因子，并分别看左右符号。`
        : s`同乘共轭式后得到 $${rationalized}$。${sine ? inverse ? '接下来整理 x/sin(kx)，不要忘记系数k。' : '接下来把正弦的自变量与分母凑成同一个量，保留补回的常数。' : '在x≠0时约去公共因子，再看剩余分母的极限。'}`],
    check: { kind: sine ? 'root-sine' : 'root-linear', k, b, variant,
      expected: contrast ? null : inverse ? 2 * b / k : k / (2 * b), leftSign: contrast ? -1 : null, rightSign: contrast ? 1 : null },
  });
}

function sineRatio(k, b) {
  const expression = s`\frac{\sin(${coefficient(k)}x)}{${coefficient(b)}x}`, result = fraction(k, b);
  return question({ id: `sine-ratio.${k}.${b}`, familyId: 'limit.sine-ratio', goal: sineGoal,
    body: s`求 $\displaystyle\lim_{x\to0}${expression}$。`,
    solution: s`$${expression}=\frac{${k}}{${b}}\cdot\frac{\sin(${coefficient(k)}x)}{${coefficient(k)}x}$。令 $u=${coefficient(k)}x\to0$，重要极限给出结果 $${result}$。`,
    routes: [route('r-important', '把分母凑成正弦自变量，补回常数，再用重要极限', [step(IMPORTANT, `$${expression}$`, s`$\frac{${k}}{${b}}\cdot\frac{\sin(${coefficient(k)}x)}{${coefficient(k)}x}\to${result}$`, '令u=kx→0；分子分母补相同的常数，保持恒等。')], '标准比值趋于1，外面的k/b必须保留。', true),
      route('r-lhopital', '检查 0/0 和可导条件，分子分母分别求导', [step(LH, `$${expression}$`, s`$${k}\cos(${coefficient(k)}x)/${b}\to${result}$`, '分子分母趋零，在邻域可导，分母导数b非零。')], '正确的替代解法；无需因为偏离目标路线判错。'),
      invalid(IMPORTANT, `$${expression}$`, '0/0是未定式，并不等于零。')],
    structure: op('divide', op('sin', op('multiply', C, V)), op('multiply', C, V)),
    hints: ['正弦重要极限要求正弦自变量与分母相同。比较现在这两个量。', s`写成 $\frac{${k}}{${b}}\cdot\frac{\sin(${coefficient(k)}x)}{${coefficient(k)}x}$。标准比值趋于1，外面的常数需要保留。`],
    check: { kind: 'sine-ratio', k, b, variant: 'normal', expected: k / b },
  });
}

function squareFactor(a) {
  const expression = s`\frac{x^2-${a * a}}{x-${a}}`;
  return question({ id: `square-factor.${a}`, familyId: 'limit.square-factor', goal: factorGoal,
    body: s`求 $\displaystyle\lim_{x\to${a}}${expression}$。`,
    solution: s`$x^2-${a * a}=(x-${a})(x+${a})$，在 $x\ne${a}$ 的去心邻域约分，原式等于 $x+${a}$，极限为 $${2 * a}$。`,
    routes: [route('r-factor', '分解平方差，在去心邻域约分后取极限', [step(FACTOR, `$${expression}$`, s`$\frac{(x-${a})(x+${a})}{x-${a}}=x+${a}\to${2 * a}$`, s`$x\ne${a}$，可约去非零公因式；不要求原式在趋近点有定义。`)], '约分消去共同的零因子；保留去心邻域条件。', true),
      route('r-lhopital', '核对 0/0 与可导条件，用洛必达求极限', [step(LH, `$${expression}$`, s`$2x\to${2 * a}$`, '分子分母都是多项式，在邻域可导，分母导数恒为1。')], '一次洛必达也能得到正确结果。'),
      invalid(FACTOR, `$${expression}$`, '分母趋于零时不能直接用商的极限法则。')],
    structure: op('divide', op('subtract', op('power', V, C), C), op('subtract', V, C)),
    hints: ['先检查分子是否是平方差，能否分解出与分母相同的因子。', s`$x^2-${a * a}=(x-${a})(x+${a})$。在 $x\ne${a}$ 时可以约分，再判断剩下的式子。`],
    check: { kind: 'square-factor', a, variant: 'normal', expected: 2 * a },
  });
}

const pools = [
  [root(2, 1), root(3, 2), root(4, 1), ...[[1, 1], [2, 1], [3, 2], [4, 1]].map(([k, b]) => root(k, b, { variant: 'contrast' })), root(1, 1, { variant: 'inverse' }), root(2, 1, { variant: 'inverse' })],
  [root(2, 1, { sine: false }), root(3, 2, { sine: false }), root(4, 1, { sine: false }), ...[[1, 1], [2, 1], [3, 2], [4, 1]].map(([k, b]) => root(k, b, { sine: false, variant: 'contrast' })), root(1, 1, { sine: false, variant: 'inverse' })],
  [sineRatio(2, 1), sineRatio(3, 2), sineRatio(5, 1)],
  [squareFactor(2), squareFactor(3), squareFactor(4)],
];

export const relatedPracticeTargets = pools.map(questions => ({ id: `RT.related.${questions[0].metadata.learning.familyId}`,
  scenarioId: ZERO, methodId: questions[0].routes[0].steps[0].methodId, name: questions[0].metadata.trainingGoal,
  localReady: true, questionCount: questions.length, questions }));
