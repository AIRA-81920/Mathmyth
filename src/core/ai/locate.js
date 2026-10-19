import { streamAnswer } from './client.js';
import { auxiliaryRequest } from './auxiliary.js';
import { locationScenarios } from '../knowledge/index.js';
import { validateQuestionRoutes } from '../chat/questionRoutes.js';

function json(text) {
  const source = String(text ?? '').trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error('归位结果格式不完整。'); }
}

export function parseBlocks(text, skeleton) {
  const ids = json(text).block_ids;
  if (!Array.isArray(ids) || ids.length > 2 || ids.some((id) => !skeleton.blockById.has(id)) || new Set(ids).size !== ids.length) {
    throw new Error('归位板块无效。');
  }
  return ids;
}

export function parseBlockLocation(text, skeleton) {
  const value = json(text);
  if (typeof value.is_math_question !== 'boolean' || (value.recognized_question != null && typeof value.recognized_question !== 'string')) throw new Error('数学题标记格式不完整。');
  return { blockIds: parseBlocks(text, skeleton), isMathQuestion: value.is_math_question,
    recognizedQuestion: value.recognized_question?.trim() || null };
}

export function parseEncounters(text, skeleton, blockIds, allowedScenarioIds) {
  const entries = json(text).encounters;
  if (!Array.isArray(entries)) throw new Error('归位连线无效。');
  const seen = new Set();
  const result = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.is_main !== 'boolean') throw new Error('归位连线无效。');
    const scenario = skeleton.scenarioById.get(entry.scenario_id);
    const methodId = entry.method_id === null ? null : skeleton.aliases.get(entry.method_id);
    if (!scenario || !(allowedScenarioIds ? allowedScenarioIds.has(scenario.id) : blockIds.includes(scenario.block_id))
      || (methodId !== null && !scenario.methods.some((edge) => edge.method_id === methodId))
      || (methodId === null && entry.is_main)) throw new Error('归位连线超出骨架。');
    const key = `${scenario.id}:${methodId}`;
    if (seen.has(key)) throw new Error('归位连线重复。');
    seen.add(key);
    return { scenario_id: scenario.id, method_id: methodId, is_main: entry.is_main };
  });
  const hasMethods = result.some((entry) => entry.method_id !== null);
  if (result.filter((entry) => entry.is_main).length !== (hasMethods ? 1 : 0)) throw new Error('归位主线不明确。');
  return result;
}

const instruction = `你是 Mathmyth 的后台归位助手。只依据已完成题面和公开解答，记录这轮明确使用或解释过的知识；不要把所有理论可用的方法都当成用户见过的。不要修改解答，不评价学生掌握度，不编造骨架 ID。仅返回要求的合法 JSON，换模型也使用相同格式。`;
function request(config, content, systemPrompt, signal, image) {
  const { imageId, ...source } = content.source;
  const text = JSON.stringify({ ...content, source });
  const message = image && config.supportsImage ? [
    { type: 'text', text: `${text}\n原图仅供核对题面，用户文字补充或修正优先；仍只记录公开解答实际使用或解释过的方法。` },
    { type: 'image_url', image_url: { url: image.dataUrl } },
  ] : text;
  return streamAnswer({ ...auxiliaryRequest(config), messages: [{ role: 'user', content: message }], systemPrompt, signal });
}

export async function locateBlocks({ config, source, image, skeleton, signal }) {
  const blocks = skeleton.blocks.map(({ id, name, summary }) => ({ id, name, summary }));
  const text = await request(config, { source, blocks }, `${instruction}\n选出相关的 1–2 个板块；无法归位时返回空数组。额外判断 source.userQuestion 这一条用户消息本身是否提出一道数学题（计算、证明、具体数学条件下的求解）。图片或文件题目也算；闲聊、只问概念定义、对先前解答某一步的追问不算。不可因为 source.question 或 context 中曾经有数学题就把当前追问也标成数学题。is_math_question 必须为 JSON 布尔值，不用字符串。recognized_question 只在用户上传图片且能够可靠看清时填写忠实转写，否则为 null；不能替用户编造题目。格式：{"block_ids":["B.xxx"],"is_math_question":true,"recognized_question":null}。`, signal, image);
  return parseBlockLocation(text, skeleton);
}

export async function locateEdges({ config, source, image, skeleton, blockIds, signal }) {
  if (!blockIds.length) return [];
  const candidates = locationScenarios(skeleton, blockIds);
  const scenarios = candidates.map((scenario) => ({
    id: scenario.id, name: scenario.name, definition: scenario.definition, signals: scenario.signals,
    methods: scenario.methods.map((edge) => ({ ...edge, name: skeleton.methodById.get(edge.method_id).name,
      one_liner: skeleton.methodById.get(edge.method_id).one_liner })),
  }));
  const text = await request(config, { source, scenarios }, `${instruction}\n返回实际接触的所有情景→方法连线。候选可跨章节；依据实际操作、结构和条件归位，不依据方法首次出现的章节。method_id只能用该情景列出的方法；实际操作无对应节点时只记录情景、method_id为null且is_main=false，不硬套相近名字。保留变形后出现的新情景。存在方法连线时，恰选一条实际主要思路为is_main=true；无方法时没有主线。\n按题目返回routes。必须区分“连续步骤”和“并列解法”：paths数组里的每一项是一种独立完整解法；只有同一种解法内部，前一步的结果成为后一步的输入，才按先后顺序写入该path.steps。不能把回答中先介绍方法甲、再介绍方法乙的文字顺序当成步骤依赖。若因式分解和洛必达各自都能直接解决同一个0/0情景，它们是并列方法，不存在0/0→0/0的路径；可分别放入独立paths，不能串接。若先由含参极限得到分段函数，再检查连续性，才构成跨情景的链。只引用encounters中已有配对，不创建步骤名。question_index仅是独立题目的序号，不能给同一题的不同解法另编题号。user_message_id使用source.userMessageId；追问沿用source.questionMessages或source.context里原题的messageId和题号。追问确实补充或修正路线时，返回该题更新后的完整paths；不要只返回一个片段让程序拼接。每步evidence逐字摘录当前source.answer或context中的公开解答，且必须能支持对应步骤，不输出阐释。格式：{"encounters":[{"scenario_id":"S.xxx","method_id":"M.xxx","is_main":true}],"routes":[{"user_message_id":"用户消息ID","question_index":1,"paths":[{"steps":[{"scenario_id":"S.xxx","method_id":"M.xxx","evidence":"公开解答原文"}]}]}]}。一次多图通常按独立题分组，明确同题续图才合并。无匹配时两个数组为空。`, signal, image);
  const encounters = parseEncounters(text, skeleton, blockIds, new Set(candidates.map(s=>s.id)));
  return { encounters, routes: validateQuestionRoutes(json(text).routes, encounters, source) };
}
