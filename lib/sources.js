/**
 * 数据源抓取:nitter.net 推文 + arXiv RSS 论文 + Twitter syndication。
 * 用原生 https / http,零依赖,Vercel 冷启动最快。
 *
 * 代理支持:设置了 SCRAPE_DO_TOKEN 环境变量后,所有出站 fetch 自动走
 * scrape.do 代理,绕过 Vercel 数据中心 IP 的限流/封锁。
 */
const https = require('https');
const http = require('http');

const TIMEOUT_MS = 6_000;
const PROXY_TOKEN = process.env.SCRAPE_DO_TOKEN;

/** 通过代理或直连抓取文本 */
function fetchText(url, { headers = {}, method = 'GET', body = null } = {}) {
  if (PROXY_TOKEN) return fetchViaProxy(url, { method, headers, body });
  return fetchDirect(url, { method, headers, body });
}

function fetchViaProxy(url, { method, headers, body }) {
  // scrape.do: ?token=KEY&url=TARGET[&render=true]
  // render=true 会用真实 Chrome 渲染(对付 JS-heavy 页面)
  // 普通页面 (nitter / arxiv) 直接抓就好,render 模式反而慢且会超时
  const needsRender = /syndication\.twitter\.com/i.test(url);
  const params = new URLSearchParams({ token: PROXY_TOKEN, url });
  if (needsRender) params.set('render', 'true');
  const proxyUrl = `https://api.scrape.do?${params.toString()}`;
  return fetchDirect(proxyUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'NEXA-Daily/3.0', ...headers },
    body: null,
  });
}

function fetchDirect(url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method, headers: { 'User-Agent': 'NEXA-Daily/3.0', ...headers }, timeout: TIMEOUT_MS,
    }, (res) => {
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
    if (body) req.write(body);
    req.end();
  });
}

/** 429 快失败:不重试(Vercel 10s 超时下重试必超时),让上层 60s 锁来防刷 */
async function fetchWithBackoff(url, opts = {}) {
  return await fetchText(url, opts);
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

/* ── 抓推文:走代理抓 nitter HTML 并解析(单一稳定路径) ──── */
const PER_USER_LIMIT = 5;

/** 直接抓 nitter.net HTML,正则解析推文列表 */
async function fetchUserTweets(username) {
  const hosts = ['https://nitter.net', 'https://nitter.poast.org'];
  let lastErr;
  for (const host of hosts) {
    try {
      // 走带 429 退避重试的 fetch,避免被代理瞬时限流
      const html = await fetchWithBackoff(`${host}/${username}`);
      const tweets = parseNitterHtml(html, host, username);
      if (tweets.length) {
        console.log(`[nitter] ${username} 通过 ${host} 拿到 ${tweets.length} 条`);
        return tweets;
      }
      lastErr = new Error('0 条');
    } catch (e) {
      lastErr = e;
      console.warn(`[nitter] ${username} @ ${host}: ${e.message}`);
      // 429 限流时不再试下一个 host(直接会挂)
      if (/HTTP 429/.test(e.message)) break;
    }
  }
  console.warn(`[nitter] ${username} 全部失败: ${lastErr?.message}`);
  return [];
}

/** 解析 nitter HTML 抽出【仅属于目标用户】的推文列表 */
function parseNitterHtml(html, host, username) {
  const targetUser = String(username || '').toLowerCase();
  const tweets = [];

  // ① 按 timeline-item 切块,每块是一条「候选推文」
  //    用 lookahead 找下一个 timeline-item 或串尾,避免贪婪匹配吞并
  const itemRe = /<div\s+class="timeline-item[^"]*"[^>]*>([\s\S]*?)(?=<div\s+class="timeline-item|<\/div>\s*<div\s+class="timeline-footer|$)/gi;
  let itemMatch;
  let debugMismatches = [];

  while ((itemMatch = itemRe.exec(html)) && tweets.length < PER_USER_LIMIT) {
    const item = itemMatch[1];

    // ② 抓出该块里【真实】的作者 username
    //    nitter 在 .tweet-body 头部会放 <a href="/user"> 链接,挨着用户头像/昵称
    //    优先匹配 .tweet-username / .tweet-name / .tweet-avatar 的 href
    const authorHrefs = item.match(/<a[^>]+class="tweet-(?:name|username|avatar)"[^>]+href="\/([^"\/?#]+)"/gi) || [];
    let actualUser = '';
    for (const ah of authorHrefs) {
      const u = ah.match(/href="\/([^"\/?#]+)"/i);
      if (u && u[1] && !/status|search|intent|home|settings|about|compose|share/i.test(u[1])) {
        actualUser = u[1].toLowerCase();
        break;
      }
    }
    // 兜底:从 /username/status/123 链接里反推
    if (!actualUser) {
      const statusLink = item.match(/href="\/([^"\/?#]+)\/status\/\d+/);
      if (statusLink) actualUser = statusLink[1].toLowerCase();
    }
    if (!actualUser) {
      debugMismatches.push({ reason: 'no-author', snippet: item.slice(0, 120) });
      continue;
    }

    // ③ 【关键】只保留真正属于目标用户的推文
    if (actualUser !== targetUser) {
      debugMismatches.push({ reason: `author=${actualUser} != ${targetUser}` });
      continue;
    }

    // ⑦ 抓推文链接
    const linkMatch = item.match(/<a[^>]+class="tweet-link"[^>]+href="([^"]+)"/);
    if (!linkMatch) continue;
    const href = linkMatch[1].replace(/#m$/, '');

    // ⑧ 抓推文正文(先拿到 text 再做内容级判断)
    const contentMatch = item.match(/<div\s+class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!contentMatch) continue;
    const text = contentMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (!text) continue;

    // ④ 跳过转推(任何形式的转推标记:内/外层 class、retweet-header、RT @ 前缀)
    const isRetweet =
      /class="[^"]*(?:retweet|retweet-header|icon-retweet)[^"]*"/i.test(item) ||
      /^[\s]*🔁/m.test(item) ||
      /\b(?:retweeted|RT\s*@\w+)/i.test(text);
    if (isRetweet) {
      debugMismatches.push({ reason: 'is-retweet' });
      continue;
    }
    // ⑤ 跳过置顶(标记为 pinned)
    if (/class="[^"]*pinned[^"]*"/i.test(item)) {
      debugMismatches.push({ reason: 'is-pinned' });
      continue;
    }
    // ⑥ 跳过推广/广告
    if (/class="[^"]*(?:promoted|ad-badge|sponsored)[^"]*"/i.test(item)) {
      debugMismatches.push({ reason: 'is-ad' });
      continue;
    }

    // ⑨ 抓推文时间
    const dateMatch = item.match(/<a[^>]+title="([^"]+)"[^>]*>[^<]+<\/a>/);
    const fullDate = dateMatch?.[1] || '';

    tweets.push({
      text,
      link: `https://twitter.com${href}`,
      time: formatNitterDate(fullDate),
    });
  }

  if (debugMismatches.length) {
    console.log(`[nitter] ${targetUser}: 丢弃 ${debugMismatches.length} 条非本人内容(${debugMismatches.slice(0,3).map(d=>d.reason).join(', ')})`);
  }
  return tweets;
}

function formatNitterDate(s) {
  // "Jun 30, 2026 · 3:00 PM UTC" -> "2026.06 15:00"
  const m = s?.match(/(\w{3})\s+(\d{1,2}),\s+(\d{4})\s+·\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i);
  if (!m) return s || '';
  let h = parseInt(m[4], 10);
  if (/PM/i.test(m[6]) && h !== 12) h += 12;
  if (/AM/i.test(m[6]) && h === 12) h = 0;
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[3]}.${months[m[1]] || '01'} ${String(h).padStart(2,'0')}:${m[5]}`;
}
function formatTwitterTime(s) {
  // "Mon Feb 10 21:11:04 +0000 2025" -> "2025.02 21:11"
  const m = s?.match(/(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):\d{2}\s+\+\d+\s+(\d{4})/);
  if (!m) return s || '';
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[5]}.${months[m[1]] || '01'} ${m[3]}:${m[4]}`;
}
function formatTweetTime(s) {
  const m = s.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return s;
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[3]}.${months[m[2]] || '01'} ${m[4]}:${m[5]}`;
}

/* ── 从 people.json 抓所有推文 ─────────────────────────── */
async function fetchAllUpdates(people) {
  const tasks = people
    .map(p => {
      const m = (p.url || '').match(/(?:xcancel|x|twitter|nitter)\.com\/([^/?#]+)/i);
      return { p, username: m?.[1] };
    })
    .filter(x => x.username);

  // 串行抓取 + 间隔 500ms,大幅降低 scrape.do 限流概率
  const results = [];
  for (const t of tasks) {
    try {
      console.log(`  → ${t.username}`);
      const tweets = await fetchUserTweets(t.username);
      results.push({ ok: true, tweets, p: t.p, username: t.username });
    } catch (e) {
      console.warn(`  ✗ ${t.username}: ${e.message}`);
      results.push({ ok: false, err: e.message, tweets: [], p: t.p, username: t.username });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const all = results.flatMap(r => r.tweets.map(t => ({
    author: r.p.name, username: r.username,
    url: r.p.url, link: t.link,
    text: t.text, time: t.time,
  })));
  all.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

  // 暴露失败详情,便于 debug
  const errors = results.filter(r => !r.ok).map(r => ({ username: r.username, err: r.err }));
  return { count: all.length, updates: all, errors };
}

module.exports = {
  fetchText, parseRssItems, decodeEntities,
  fetchArxivPapers, fetchAllUpdates, fetchUserTweets,
};