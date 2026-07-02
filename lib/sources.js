/**
 * 数据源抓取:nitter.net 推文 + arXiv RSS 论文。
 * 用原生 https / http,零依赖,Vercel 冷启动最快。
 */
const https = require('https');
const http = require('http');

const TIMEOUT_MS = 15_000;

function fetchText(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'NEXA-Daily/3.0', ...headers }, timeout: TIMEOUT_MS }, (res) => {
      // 跟随一次重定向
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchText(res.headers.location, { headers }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

/* ── RSS 解析(简化版,够用) ─────────────────────────────── */
function parseRssItems(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    items.push({
      title: pick(block, 'title'),
      link: pick(block, 'link'),
      description: pick(block, 'description'),
      pubDate: pick(block, 'pubDate'),
    });
  }
  return items;
}
function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
}
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/* ── 抓 arXiv 论文 ─────────────────────────────────────── */
const ARXIV_FEEDS = [
  'https://rss.arxiv.org/rss/cs.AI',
  'https://rss.arxiv.org/rss/cs.CL',
  'https://rss.arxiv.org/rss/cs.LG',
];
const ARXIV_MAX = 12;

async function fetchArxivPapers() {
  const all = [];
  for (const url of ARXIV_FEEDS) {
    try {
      const xml = await fetchText(url);
      for (const item of parseRssItems(xml)) {
        all.push({
          title: decodeEntities(item.title).replace(/\s+/g, ' '),
          subtitle: decodeEntities(item.description).replace(/\s+/g, ' ').slice(0, 300),
          url: item.link,
          date: formatArxivDate(item.pubDate),
        });
      }
    } catch (e) {
      console.warn('[arxiv]', url, e.message);
    }
  }
  // 去重 (按 url)+ 按日期倒序
  const seen = new Set();
  const dedup = all.filter(p => {
    if (!p.url || seen.has(p.url)) return false;
    seen.add(p.url); return true;
  });
  dedup.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { count: Math.min(dedup.length, ARXIV_MAX), papers: dedup.slice(0, ARXIV_MAX) };
}
function formatArxivDate(s) {
  const m = s.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return s.slice(0, 10);
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[3]}.${months[m[2]] || '01'}`;
}

/* ── 抓 Nitter 推文 ────────────────────────────────────── */
const NITTER_HOSTS = ['https://nitter.net', 'https://nitter.poast.org', 'https://nitter.privacydev.net'];
const PER_USER_LIMIT = 5;

async function fetchUserTweets(username) {
  let lastErr;
  for (const host of NITTER_HOSTS) {
    try {
      const xml = await fetchText(`${host}/${username}/rss`);
      const items = parseRssItems(xml).slice(0, PER_USER_LIMIT);
      return items.map(it => ({
        text: decodeEntities(it.title).replace(/^@\w+:\s*/, '').slice(0, 500),
        link: it.link,
        time: formatTweetTime(it.pubDate),
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn(`[nitter] ${username} 全部镜像失败: ${lastErr?.message}`);
  return [];
}
function formatTweetTime(s) {
  const m = s.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return s;
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[3]}.${months[m[2]] || '01'} ${m[4]}:${m[5]}`;
}

/* ── 从 people.json 抓所有推文 ─────────────────────────── */
async function fetchAllUpdates(people) {
  const all = [];
  for (const p of people) {
    const m = (p.url || '').match(/(?:xcancel|x|twitter|nitter)\.com\/([^/?#]+)/i);
    const username = m?.[1];
    if (!username) continue;
    console.log(`  → ${username}`);
    const tweets = await fetchUserTweets(username);
    for (const t of tweets) {
      all.push({
        author: p.name, username,
        url: p.url, link: t.link,
        text: t.text, time: t.time,
      });
    }
  }
  all.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return { count: all.length, updates: all };
}

module.exports = {
  fetchText, parseRssItems, decodeEntities,
  fetchArxivPapers, fetchAllUpdates,
};