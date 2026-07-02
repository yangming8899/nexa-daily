/**
 * 共享存储:支持两层
 *
 *   L1 进程内存(快,但 Vercel 不同函数实例不共享)
 *   L2 Vercel KV(慢一点,但跨实例持久)
 *
 * 读: 先 L1,miss 时读 L2,miss 时返回 seed
 * 写: 同时写 L1 + L2
 *
 * 这样:
 * - 同一实例连续调用: 走 L1,极快
 * - 跨实例 / 冷启动: 走 L2,数据还在
 */
const path = require('path');
const fs = require('fs');

const CONFIG_DIR = path.join(process.cwd(), 'config');
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf-8'));
}

// ── Vercel KV REST 调用(原生 fetch,零依赖) ───────────────
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.result) return null;
    // Upstash 返回的可能是字符串,也可能是带引号的 JSON 字符串
    try { return JSON.parse(j.result); } catch { return j.result; }
  } catch (e) {
    console.warn('[kv] get failed:', e.message);
    return null;
  }
}
async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    // 用 GET /set/{key}/{value} 路径,简单可靠
    const encodedKey = encodeURIComponent(key);
    const encodedValue = encodeURIComponent(JSON.stringify(value));
    const r = await fetch(`${KV_URL}/set/${encodedKey}/${encodedValue}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!r.ok) {
      console.warn('[kv] set non-OK:', r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[kv] set failed:', e.message);
    return false;
  }
}

// ── Seed 数据 ─────────────────────────────────────────────
function seedUpdates() {
  const people = readJson('people.json').people;
  return {
    generated_at: new Date().toISOString(),
    count: 0,
    updates: [],
    note: '尚未抓取实时推文,点击「刷新全部」获取',
    people,
  };
}
function seedPapers() {
  const papers = readJson('papers.json').papers;
  return {
    generated_at: new Date().toISOString(),
    count: papers.length,
    papers: papers.map(p => ({ ...p, date: 'seed' })),
    note: '尚未抓取 arXiv 实时论文,显示配置中的精选论文',
  };
}

// ── L1 内存 ───────────────────────────────────────────────
const cache = { updates: null, papers: null, summary: null };

// ── L2 读写包装 ───────────────────────────────────────────
async function getData(key, seedFn) {
  if (cache[key]) return cache[key];
  const fromKv = await kvGet(`nexa:${key}`);
  if (fromKv) {
    cache[key] = fromKv;
    return fromKv;
  }
  const seed = seedFn();
  cache[key] = seed;
  return seed;
}
async function setData(key, data) {
  const final = { ...data, generated_at: data.generated_at || new Date().toISOString() };
  cache[key] = final;
  // 异步写 KV,不等它返回(API 响应更快)
  kvSet(`nexa:${key}`, final).catch(() => {});
  return final;
}

// ── 公开 API ──────────────────────────────────────────────
const getUpdates  = () => getData('updates',  seedUpdates);
const setUpdates  = d  => setData('updates',  d);
const getPapers   = () => getData('papers',   seedPapers);
const setPapers   = d  => setData('papers',   d);
const getSummary  = async () => {
  const d = await getData('summary', () => null);
  if (!d) return {
    generated_at: null,
    summary: '',
    source_counts: { updates: (await getUpdates()).count, papers: (await getPapers()).count },
    note: '尚未生成 AI 总结,点击「✨ AI 总结」按钮生成',
  };
  return d;
};
const setSummary  = d  => setData('summary',  d);

// 预热(不 await,fire-and-forget)
if (KV_URL) {
  getUpdates().catch(() => {});
  getPapers().catch(() => {});
}

module.exports = {
  getUpdates, setUpdates,
  getPapers,  setPapers,
  getSummary, setSummary,
};