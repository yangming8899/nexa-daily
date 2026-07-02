/**
 * GET /api/summary
 * 返回当前 AI 总结 + meta,前端 Modal 打开时用它
 */
const store = require('../lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const summary = store.getSummary();
  res.setHeader('Cache-Control', 'no-store');
  res.json(summary);
};