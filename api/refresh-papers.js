/**
 * GET /api/refresh-papers
 * 从 arXiv RSS 抓最新 AI 论文 → 写入 store
 */
const store = require('../lib/store');
const sources = require('../lib/sources');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    console.log('[refresh-papers] 抓取 arXiv…');
    const result = await sources.fetchArxivPapers();
    const saved = store.setPapers(result);
    console.log(`[refresh-papers] 完成,共 ${saved.count} 篇`);
    res.json({ ok: true, count: saved.count, generated_at: saved.generated_at });
  } catch (e) {
    console.error('[refresh-papers]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};