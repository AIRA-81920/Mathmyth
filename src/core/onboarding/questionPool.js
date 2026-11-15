// 首次引导的题库：用户一进来没题，我们替他放一道。
//
// 为什么是"固定题池"而不是让用户随便写：
//   本题路径与"试一道类似题"要靠知识骨架和题库命中，题目越规整越稳。
//   一道足够清晰、有多种解法的经典题，几乎是必中的。
//
// 加题之前必须实机验证三件事，缺一不可：
//   ① 本题路径能出（不是"尚未匹配本题路径"）
//   ② "试一道类似题"能出（不是"暂时没有可换的练习"）
//   ③ 答案与本机模型匹配，回答时长在一分钟内
// 随机取一道的意思不是"随便什么题都行"——而是这几道都已经过验证。
export const TOUR_QUESTIONS = {
  advanced: [
    { label: '1^∞ 型', question: '$$\\lim_{x\\to 1}x^{\\frac{x}{x-1}}$$' },
    { label: '根式差', question: '$$\\lim_{x\\to 0}\\frac{\\sqrt{1+\\sin x}-1}{x}$$' },
    { label: '三角等价', question: '$$\\lim_{x\\to 0}\\frac{1-\\cos x}{x\\sin x}$$' },
  ],
  high_school: [
    { label: '三次函数单调性', question: '已知 $f(x)=x^{3}-3x$，求 $f(x)$ 的单调区间与极值。' },
    { label: '切线方程', question: '求曲线 $y=x^{3}-2x$ 在点 $(1,-1)$ 处的切线方程。' },
    { label: '对数最值', question: '已知 $f(x)=\\ln x-x$，求 $f(x)$ 的最大值。' },
  ],
};

export function pickTourQuestion(subject) {
  const pool = TOUR_QUESTIONS[subject === 'high_school' ? 'high_school' : 'advanced'];
  return pool[Math.floor(Math.random() * pool.length)];
}

// 引导跑到一半被打断（刷新、切后台被系统回收）时，下次进来要能接上。
// 只记题面：它本身就是"这道题是我们让他发的"的凭据——库里有这么一条用户消息，
// 就说明那一步已经做过了，从下一步接着走，不逼人重发一遍。
const PENDING_KEY = 'mathmyth.tour.pending.v1';

export const readPendingGuide = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return typeof value?.question === 'string' && value.question ? value : null;
  } catch { return null; }
};

export const writePendingGuide = (question) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ question, at: Date.now() })); } catch { /* 隐私模式 */ }
};

export const clearPendingGuide = () => {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* 同上 */ }
};
