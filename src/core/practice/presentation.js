// Student-facing wording is distinct from the internal training objective.
const goals = {
  'RT.batch1.infinity': { title: '两个越来越大的式子相减', description: '两部分都越来越大，它们的差却不一定很大。这组练习让你判断：先怎么变形，变形后又该怎么继续算。', example: '$\\sqrt{x^2+x}-x$，其中 $x\\to+\\infty$。' },
  'RT.batch1.cancellation': { title: '分子、分母都趋于 0 的极限', description: '直接代入会得到 0/0，算不出答案。有些题还会先减掉一部分；你要判断，剩下的部分该怎样继续处理。', example: '$\\sin(3x)/x$，或 $[\\tan x-\\sin x]/\\ln(1+x^3)$，其中 $x\\to0$。' },
  'RT.batch1.power': { title: '底数接近 1，指数却越来越大的极限', description: '不能只把底数代成 1 就结束。你要把底数和指数放在一起判断，变形后再继续求极限。', example: '$(1+2x)^{1/x}$，其中 $x\\to0$。' },
  'RT.batch1.implicit': { title: '方程里同时有 x 和 y，怎么求导', description: '题目没有直接写出 y 等于什么，而是给了 x 和 y 的关系。有的题求出导数后，还要继续求二阶导数或切线。', example: '$e^y+xy=e$，求 $y\\prime$。' },
  'RT.batch1.expression': { title: '指数、根号和复合函数的求导', description: '先看清谁随 x 变化、哪个函数套在里面，再判断怎么求导。带根号的题还要看：在哪些 x 上，函数和导数才有意义。', example: '$a^{\\sin x}$ 与 $x^{\\sin x}$：一个底数固定，一个底数也随 x 变化。' },
  'RT.batch1.higher': { title: '要连续求很多次导数的题', description: 'n 阶导数就是连续求导 n 次。有些式子换一种写法就能少算很多；你要判断哪条路线更省事，并留意每次求导带来的系数。', example: '$x^2e^{-x}$ 求十阶导数，或 $\\sin^6x+\\cos^6x$ 求 n 阶导数。' },
  'RT.limit.continuity': { title: '分段函数在接头处是否连续', description: '分别看从左边靠近、从右边靠近时趋向什么，再与接头处给定的函数值比较。', example: '' },
  'RT.indefint.substitution': { title: '积分里有一层套一层的函数', description: '看能否换一个变量把式子变简单；换完以后，可能还需要继续处理新出现的积分。', example: '' },
  'RT.indefint.parts': { title: '多项式乘指数或三角函数的积分', description: '看怎样把一次积分拆成更容易的部分，有时需要重复几次才能结束。', example: '' },
  'RT.defint.sign-split': { title: '带绝对值的定积分', description: '绝对值里面的式子可能变号。判断哪些地方要分开计算，以及能不能少算一部分。', example: '' },
  'RT.ode.homogeneous-chain': { title: '含 y/x 的一阶微分方程', description: '先判断怎么改写变量关系，再看新的方程能否解下去；除以一个式子时，还要留意有没有漏掉解。', example: '' },
};
export function practicePresentation(target) {
  return target.presentation ?? goals[target.id] ?? { title: target.scenarioName || '读题后判断解法',
    description: '先看完整题目，再选出能把题做下去的路线；也可以用自己的话写关键步骤。', example: '' };
}
