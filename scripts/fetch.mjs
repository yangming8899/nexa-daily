#!/usr/bin/env node
/**
 * GitHub Actions / 本地定时抓取脚本
 *
 * 数据流:
 *   people.json → scrape.do 抓 nitter HTML → parseNitterHtml → sort 合并
 *   → 写到 data/cache.json → commit & push
 *
 * 为什么独立:
 *   - 避免 Vercel 函数被 scrape.do 限流(同一 proxy token)
 *   - GitHub Actions 调度稳定,免费,比 Vercel cron 更可靠
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/people.json'), 'utf-8'));
const PROXY_TOKEN = process.env.SCRAPE_DO_TOKEN || '';

const PER_USER_LIMIT = 5;
const TIMEOUT_MS = 8000;
const HOSTS = ['https://nitter.net', 'https://nitter.poast.org'];

// ── HTTP ──
async function fetchText(url) {
  if (PROXY_TOKEN) {
    const proxyUrl = `https://api.scrape.do?token=${PROXY_TOKEN}&url=${encodeURIComponent(url)}`;
    try {
      return await fetchDirect(proxyUrl, { 'User-Agent': 'NEXA-Daily/3.0' });
    } catch (e) {
      if (!/HTTP (429|5\d\d)/.test(e.message)) throw e;
      console.warn(`[proxy] ${e.message.slice(0, 60)}, fallback to direct`);
      // fallback to direct (may fail in CI but worth trying)
    }
  }
  return fetchDirect(url, { 'User-Agent': 'NEXA-Daily/3.0' });
}

function fetchDirect(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { headers, timeout: TIMEOUT_MS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ── 推文链接真实性验证 ──
// 用 publish.x.com/oEmbed 验证 tweet 是否真实存在
// 返回 true=真, false=假(被删/未发布)
async function verifyLink(link) {
  if (!link || !link.includes('/status/')) return false;
  // 加快速度:跳过假 ID 格式
  if (link.includes('1818300000000000000') || link.includes('181830000000000000')) return false; // 历史残留
  const u = `https://publish.x.com/oembed?omit_script=true&url=${encodeURIComponent(link)}`;
  try {
    const data = await fetchDirect(u, { 'User-Agent': 'NEXA-Daily/3.0' });
    return data.startsWith('{') && data.includes('"author_name"');
  } catch (e) {
    // 网络错误当 unknown,放行(总比 false positive 强)
    return true;
  }
}

// ── Nitter HTML 解析(严格按作者过滤) ──
function parseNitterHtml(html, targetUser) {
  const target = String(targetUser || '').toLowerCase();
  const tweets = [];
  const itemRe = /<div\s+class="timeline-item[^"]*"[^>]*>([\s\S]*?)(?=<div\s+class="timeline-item|<\/div>\s*<div\s+class="timeline-footer|$)/gi;
  let debugMismatches = [];
  let m;
  while ((m = itemRe.exec(html)) && tweets.length < PER_USER_LIMIT) {
    const item = m[1];
    const authorHrefs = item.match(/<a[^>]+class="tweet-(?:name|username|avatar)"[^>]+href="\/([^"\/?#]+)"/gi) || [];
    let actualUser = '';
    for (const ah of authorHrefs) {
      const u = ah.match(/href="\/([^"\/?#]+)"/i);
      if (u && u[1] && !/status|search|intent|home|settings|about|compose|share/i.test(u[1])) {
        actualUser = u[1].toLowerCase();
        break;
      }
    }
    if (!actualUser) {
      const sl = item.match(/href="\/([^"\/?#]+)\/status\/\d+/);
      if (sl) actualUser = sl[1].toLowerCase();
    }
    if (!actualUser || actualUser !== target) {
      debugMismatches.push({ reason: 'author-mismatch', actual: actualUser });
      continue;
    }
    if (/class="[^"]*pinned[^"]*"/i.test(item)) { debugMismatches.push({ reason: 'pinned' }); continue; }
    if (/class="[^"]*(?:promoted|ad-badge|sponsored)[^"]*"/i.test(item)) { debugMismatches.push({ reason: 'ad' }); continue; }
    // 注意:不跳过 retweet-header —— nitter 把 "Yann retweeted" 显示成 retweet-header,
    // 但其实引文后还有 ylecun 自己的评论内容 (quote-retweet),不算纯转推
    // const isRetweet = /class="[^"]*(?:retweet-header)[^"]*"/i.test(item) || /^🔁/m.test(item);
    // if (isRetweet) { debugMismatches.push({ reason: 'retweet' }); continue; }
    // 提取推文正文
    const contentMatch = item.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!contentMatch) continue;
    let text = contentMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const linkMatch = item.match(/href="\/([^"\/?#]+)\/status\/(\d+)(?:#[^"]*)?"/);
    const statusId = linkMatch?.[2];
    const dateMatch = item.match(/<a[^>]+title="([^"]+)"[^>]*>[^<]+<\/a>/);
    const time = formatDate(dateMatch?.[1] || '');
    if (!statusId) continue;
    tweets.push({
      text: text.slice(0, 500),
      link: `https://twitter.com/${target}/status/${statusId}`,
      time,
    });
  }
  return { tweets, dropped: debugMismatches.length };
}

function formatDate(s) {
  if (!s) return '';
  const m = s.match(/(\w{3})\s+(\d{1,2}),\s+(\d{4})/i);
  if (!m) return s.slice(0, 10);
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[3]}.${months[m[1]] || '01'}`;
}

async function fetchUser(username) {
  const errors = [];
  for (const host of HOSTS) {
    try {
      const html = await fetchText(`${host}/${username}`);
      const r = parseNitterHtml(html, username);
      if (r.tweets.length) return { tweets: r.tweets, source: host, dropped: r.dropped };
      errors.push(`${host}: 0 valid`);
    } catch (e) {
      errors.push(`${host}: ${e.message.slice(0, 80)}`);
      if (/HTTP 429/.test(e.message)) break;
    }
  }
  return { tweets: [], errors };
}

// ── 主流程 ──
(async () => {
  const tasks = CONFIG.people.map(p => {
    const m = (p.url || '').match(/(?:xcancel|x|twitter|nitter)\.com\/([^/?#]+)/i);
    return { p, username: m?.[1] };
  }).filter(x => x.username);

  console.log(`[fetch] 抓取 ${tasks.length} 位博主…  proxy=${PROXY_TOKEN ? 'on' : 'off'}`);

  const results = [];
  for (const t of tasks) {
    const r = await fetchUser(t.username);
    results.push({ p: t.p, username: t.username, ...r });
    if (r.tweets.length) {
      console.log(`  ✓ ${t.username}: ${r.tweets.length} 条 (丢弃 ${r.dropped || 0} 条非本人)`);
    } else {
      console.log(`  ✗ ${t.username}: ${(r.errors || []).join(', ').slice(0, 100)}`);
    }
    // 每人间隔 800ms,降低 scrape.do 限流
    await new Promise(r => setTimeout(r, 800));
  }

  const all = [];
  for (const r of results) {
    for (const tw of r.tweets) {
      all.push({
        author: r.p.name,
        username: r.username,
        url: r.p.url,
        link: tw.link,
        text: tw.text,
        time: tw.time,
      });
    }
  }
  all.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

  // 关键防御: 用 publish.x.com/oEmbed 验证每个 link 真实存在
  // (防止 "Hmm...this page doesn't exist" 的假链接流入 cache.json)
  console.log(`[fetch] 验证 ${all.length} 条链接真实性…`);
  const verified = [];
  for (const u of all) {
    if (await verifyLink(u.link)) {
      verified.push(u);
    } else {
      console.warn(`[verify] ✗ 跳过假链接: ${u.author} - ${u.link}`);
    }
  }
  console.log(`[verify] 通过 ${verified.length}/${all.length}`);

  // 至少抓到 3 条才覆盖 cache.json;否则保留老的
  const oldPath = path.join(ROOT, 'data/cache.json');
  let oldData = null;
  try { oldData = JSON.parse(fs.readFileSync(oldPath, 'utf-8')); } catch (e) {}
  const oldCount = oldData?.count || 0;

  if (verified.length >= 3) {
    // 写入新数据
    const out = {
      updates: verified,
      generated_at: new Date().toISOString(),
      count: verified.length,
      note: `GH Actions 抓取 @ ${new Date().toISOString().slice(0, 10)}`,
    };
    fs.writeFileSync(oldPath, JSON.stringify(out, null, 2));
    console.log(`[fetch] 写入 cache.json: ${verified.length} 条`);
  } else {
    console.log(`[fetch] 只抓到 ${verified.length} 条(< 3),保留老的 ${oldCount} 条`);
    // 没新数据 = 不覆盖 = workflow 不需要 commit,push 不会乱动
  }

  // 不 exit 1,即使失败也让 workflow green,只在日志说明
  process.exit(0);
})().catch(e => { console.error('[fetch] fatal:', e); process.exit(0); /* 也不致命 */ });
