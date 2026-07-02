/**
 * GET /api/data
 * 返回:people 关注列表 + 静态精选论文 + 当前 updates/papers/summary 状态
 * 这是首页初始加载的接口,前端一次性拿到所有静态配置 + 当前数据快照
 */
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');

const CONFIG_DIR = path.join(process.cwd(), 'config');
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf-8'));
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const people = readJson('people.json').people;
    const seedPapers = readJson('papers.json').papers;
    const updates = store.getUpdates();
    const papers = store.getPapers();
    const summary = store.getSummary();

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      people,
      papers: papers.count ? papers.papers : seedPapers, // 没抓过 arXiv 时显示精选
      updates: updates.updates || [],
      updates_meta: {
        generated_at: updates.generated_at,
        count: updates.count,
        note: updates.note,
      },
      papers_meta: {
        generated_at: papers.generated_at,
        count: papers.count,
        note: papers.note,
      },
      summary: summary.summary || '',
      summary_meta: {
        generated_at: summary.generated_at,
        source_counts: summary.source_counts,
        note: summary.note,
      },
    });
  } catch (e) {
    console.error('[api/data]', e);
    res.status(500).json({ error: e.message });
  }
};