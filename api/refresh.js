/**
 * GET /api/refresh
 * 抓取所有关注人的最新推文 → 写入 store → 返回结果
 *
 * 设计:返回 {ok, count, note}
 * 即使失败(部分人抓不到)也返回 200,前端可以从 store 读取上次成功的数据
 */
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const sources = require('../lib/sources');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const people = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'people.json'), 'utf-8')).people;
    console.log(`[refresh] 抓取 ${people.length} 位专家…`);
    const result = await sources.fetchAllUpdates(people);
    const saved = store.setUpdates(result);
    console.log(`[refresh] 完成,共 ${saved.count} 条`);
    res.json({ ok: true, count: saved.count, generated_at: saved.generated_at });
  } catch (e) {
    console.error('[refresh]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};