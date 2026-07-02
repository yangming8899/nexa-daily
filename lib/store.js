/**
 * 共享存储:把 updates/papers/summary 缓存在内存中。
 *
 * 设计要点:
 * - 每个 Vercel Function 实例有独立内存,进程级别缓存够用
 * - 冷启动时,如果内存为空,自动从 config 里的静态数据补一份"种子"
 *   (这样即使抓取脚本暂时失败,网站也不会空白)
 * - 所有 API 共享这套读取/写入接口,以后想换 Redis / Vercel KV,改这里就行
 */
const path = require('path');
const fs = require('fs');

const CONFIG_DIR = path.join(process.cwd(), 'config');

function readJson(file) {
  const p = path.join(CONFIG_DIR, file);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ── 静态种子数据(冷启动时用) ─────────────────────────────────
function seedUpdates() {
  const people = readJson('people.json').people;
  const now = new Date().toISOString();
  return {
    generated_at: now,
    count: 0,
    updates: [],
    seed_from: 'config/people.json',
    note: '尚未抓取实时推文,点击「刷新全部」获取',
    people,
  };
}

function seedPapers() {
  const papers = readJson('papers.json').papers;
  const now = new Date().toISOString();
  return {
    generated_at: now,
    count: papers.length,
    papers: papers.map(p => ({ ...p, date: 'seed' })),
    seed_from: 'config/papers.json',
    note: '尚未抓取 arXiv 实时论文,显示配置中的精选论文',
  };
}

// ── 全局缓存 ──────────────────────────────────────────────
const cache = {
  updates: null,
  papers: null,
  summary: null,
};

// 模块加载时尝试读一次本地文件(开发模式 or 冷启动 fallback)
function tryLoadFromDisk() {
  try {
    const uPath = path.join(process.cwd(), 'data', 'updates.json');
    const pPath = path.join(process.cwd(), 'data', 'papers.json');
    const sPath = path.join(process.cwd(), 'data', 'summary.json');
    if (fs.existsSync(uPath)) cache.updates = JSON.parse(fs.readFileSync(uPath, 'utf-8'));
    if (fs.existsSync(pPath)) cache.papers = JSON.parse(fs.readFileSync(pPath, 'utf-8'));
    if (fs.existsSync(sPath)) cache.summary = JSON.parse(fs.readFileSync(sPath, 'utf-8'));
  } catch (_) {}
}

function persistToDisk(name, data) {
  try {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2), 'utf-8');
  } catch (_) {
    // Vercel 上文件系统是只读的,这里会失败,但不影响内存
  }
}

// ── 公开 API ──────────────────────────────────────────────
function getUpdates() {
  if (!cache.updates) cache.updates = seedUpdates();
  return cache.updates;
}
function setUpdates(data) {
  cache.updates = { ...data, generated_at: data.generated_at || new Date().toISOString() };
  persistToDisk('updates.json', cache.updates);
  return cache.updates;
}

function getPapers() {
  if (!cache.papers) cache.papers = seedPapers();
  return cache.papers;
}
function setPapers(data) {
  cache.papers = { ...data, generated_at: data.generated_at || new Date().toISOString() };
  persistToDisk('papers.json', cache.papers);
  return cache.papers;
}

function getSummary() {
  if (!cache.summary) {
    return {
      generated_at: null,
      summary: '',
      source_counts: { updates: getUpdates().count, papers: getPapers().count },
      note: '尚未生成 AI 总结,点击「✨ AI 总结」按钮生成',
    };
  }
  return cache.summary;
}
function setSummary(data) {
  cache.summary = { ...data, generated_at: data.generated_at || new Date().toISOString() };
  persistToDisk('summary.json', cache.summary);
  return cache.summary;
}

tryLoadFromDisk();

module.exports = {
  getUpdates, setUpdates,
  getPapers, setPapers,
  getSummary, setSummary,
  seedUpdates, seedPapers,
};