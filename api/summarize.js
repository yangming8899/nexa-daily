/**
 * GET /api/summarize
 * 基于当前 updates + papers 生成中文 AI 总结 → 写入 store
 */
const store = require('../lib/store');
const { callMinimax, stripThinking } = require('../lib/minimax');

function buildPrompt(updates, papers) {
  const lines = [
    '你是 NEXA Daily 的 AI 编辑。请根据以下今日 AI 领域推文和论文,生成一份中文总结报告。',
    '',
    '要求:',
    '1. 挑选出 3-5 条最值得关注的推文动态,简述其内容及为什么重要',
    '2. 挑选出 2-3 篇最值得读的论文,简述核心贡献',
    '3. 用中文输出,语气专业简洁,像一份日报简报',
    '4. 总字数控制在 400 字以内',
    '5. 格式: 先写一个总体概述(1-2句),然后用 ### 关注动态 和 ### 论文推荐 两个小标题分开',
    '',
  ];
  if (updates?.length) {
    lines.push('--- 今日推文动态 ---');
    for (const u of updates.slice(0, 20)) {
      lines.push(`[${u.author} @${u.username}] ${(u.text || '').slice(0, 300)}`);
    }
  }
  if (papers?.length) {
    lines.push('\n--- 今日论文 ---');
    for (const p of papers.slice(0, 12)) {
      lines.push(`《${p.title}》: ${(p.subtitle || '').slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const updates = store.getUpdates().updates || [];
    const papers = store.getPapers().papers || [];
    if (!updates.length && !papers.length) {
      return res.status(400).json({ ok: false, error: '请先点击「刷新全部」抓取推文和论文' });
    }

    console.log(`[summarize] 基于 ${updates.length} 条推文 + ${papers.length} 篇论文生成总结…`);
    const prompt = buildPrompt(updates, papers);
    const raw = await callMinimax([{ role: 'user', content: prompt }], { maxTokens: 1200 });
    const summary = stripThinking(raw);
    if (!summary) throw new Error('AI 返回为空');

    const saved = store.setSummary({
      summary,
      source_counts: { updates: updates.length, papers: papers.length },
    });
    console.log('[summarize] 完成');
    res.json({ ok: true, generated_at: saved.generated_at });
  } catch (e) {
    console.error('[summarize]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};