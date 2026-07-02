/**
 * POST /api/chat
 * body: { question: string, history: [{role, content}] }
 * 基于今日 updates + papers + summary 回答用户提问
 */
const store = require('../lib/store');
const { callMinimax, stripThinking } = require('../lib/minimax');

function buildMessages(updates, papers, summary, history, question) {
  const today = new Date().toISOString().slice(0, 10);
  const sys = [
    `你是 NEXA Daily 的 AI 助手,名叫 NEXA。今天是 ${today}。`,
    '你的职责是基于今日 AI 领域的推文和论文,回答用户的问题。',
    '回答要求:',
    '1. 用中文回答,语气友好专业,像一位博学的同事在跟用户聊',
    '2. 回答要具体,引用今日推文/论文的内容,不要泛泛而谈',
    '3. 如果用户问的概念今日推文/论文中提到,优先用这些内容解释',
    '4. 如果用户问的是初学者问题(如何入门),用通俗语言并给出今天内容中适合新手的部分',
    '5. 回答控制在 300 字以内,除非用户明确要求长文',
    '6. 必要时使用 markdown 格式:**加粗** 强调重点,适当分行',
  ].join('\n');

  let ctx = '\n\n--- 今日 AI 总结 ---\n' + ((summary || '').slice(0, 1500) || '(尚未生成)');
  if (updates?.length) {
    ctx += '\n\n--- 今日推文 (前 25 条) ---';
    for (const u of updates.slice(0, 25)) {
      ctx += `\n[${u.author || ''}] ${(u.text || '').slice(0, 200)}`;
    }
  }
  if (papers?.length) {
    ctx += '\n\n--- 今日论文 (前 10 篇) ---';
    for (const p of papers.slice(0, 10)) {
      ctx += `\n《${p.title || ''}》: ${(p.subtitle || '').slice(0, 150)}`;
    }
  }

  const msgs = [{ role: 'system', content: sys + ctx }];
  for (const h of (history || []).slice(-6)) msgs.push(h);
  msgs.push({ role: 'user', content: question });
  return msgs;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const question = (body.question || '').trim();
    if (!question) return res.status(400).json({ ok: false, error: '问题不能为空' });
    const history = body.history || [];

    const updates = store.getUpdates().updates || [];
    const papers = store.getPapers().papers || [];
    const summary = store.getSummary().summary || '';

    const messages = buildMessages(updates, papers, summary, history, question);
    const raw = await callMinimax(messages, { maxTokens: 1500 });
    const answer = stripThinking(raw);
    if (!answer) throw new Error('AI 返回为空');

    res.json({ ok: true, answer });
  } catch (e) {
    console.error('[chat]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};