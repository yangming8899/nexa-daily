/**
 * 单文件 API catch-all,所有路由共享同一进程内存 + Vercel KV。
 */
const path = require('path');
const fs = require('fs');
const store = require('../lib/store');
const sources = require('../lib/sources');
const { callMinimax, stripThinking } = require('../lib/minimax');

const CONFIG_DIR = path.join(process.cwd(), 'config');
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf-8'));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── 刷新锁:30 秒内多次点刷新只跑 1 次,避免 scrape.do 限流 ──
const _refreshLocks = new Map();
function acquireRefreshLock(key, ttlMs = 30_000) {
  const now = Date.now();
  const last = _refreshLocks.get(key) || 0;
  if (now - last < ttlMs) {
    return { acquired: false, waitLeftMs: ttlMs - (now - last) };
  }
  _refreshLocks.set(key, now);
  return { acquired: true };
}

// ── GET /api/data ──────────────────────────────────────────
async function handleData(req, res) {
  const people = readJson('people.json').people;
  const seedPapers = readJson('papers.json').papers;
  const [updates, papers, summary] = await Promise.all([
    store.getUpdates(),
    store.getPapers(),
    store.getSummary(),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    people,
    papers: papers.count ? papers.papers : seedPapers,
    updates: updates.updates || [],
    updates_meta: { generated_at: updates.generated_at, count: updates.count, note: updates.note },
    papers_meta:  { generated_at: papers.generated_at,  count: papers.count,  note: papers.note },
    summary: summary.summary || '',
    summary_meta: { generated_at: summary.generated_at, source_counts: summary.source_counts, note: summary.note },
  });
}

// ── GET /api/refresh ───────────────────────────────────────
async function handleRefresh(req, res) {
  // 防刷锁:60s 内只跑一次,避免 scrape.do 限流
  const lock = acquireRefreshLock('refresh', 60_000);
  if (!lock.acquired) {
    return res.status(429).json({
      ok: false,
      error: `刷新太频繁,还有 ${Math.ceil(lock.waitLeftMs / 1000)}s 才能再点`,
      waitMs: lock.waitLeftMs,
    });
  }
  const people = readJson('people.json').people;
  console.log(`[refresh] 抓取 ${people.length} 位专家…`);
  const debug = req.url?.includes('debug=1');
  const result = await sources.fetchAllUpdates(people);
  console.log(`[refresh] 抓取结果: count=${result.count}, updates=${result.updates.length}, errors=${result.errors?.length || 0}`);
  for (const e of (result.errors || [])) {
    console.log(`[refresh] err @${e.username}: ${e.err}`);
  }
  // 保护:如果抓了 0 条且 KV 里有老数据,保留老数据(避免 scrape.do 限流覆盖掉)
  let saved;
  if (result.count === 0) {
    const old = await store.getUpdates();
    if ((old.updates || []).length > 0) {
      console.log(`[refresh] 抓到 0 条,保留 KV 里 ${old.updates.length} 条老数据`);
      saved = { count: old.updates.length, updates: old.updates, generated_at: old.generated_at, kept_old: true };
    } else {
      saved = await store.setUpdates(result);
    }
  } else {
    saved = await store.setUpdates(result);
  }
  console.log(`[refresh] 完成,共 ${saved.count} 条`);
  // debug: 还探测每个用户当前的抓取状态
  let probe = null;
  if (debug) {
    probe = [];
    const s = require('../lib/sources');
    for (const p of people) {
      const u = (p.url||'').match(/(?:xcancel|x|twitter|nitter)\.com\/([^/?#]+)/i)?.[1];
      if (!u) continue;
      try {
        const r = await s.fetchUserTweets(u);
        // 也返回 sample HTML 片段,排查过滤
        let html = '', fetchErr = null;
        try {
          html = await s.fetchText(`https://nitter.net/${u}`);
        } catch (e) { fetchErr = e.message; }
        probe.push({
          user: u,
          name: p.name,
          count: r.length,
          sample_text: r.slice(0, 2).map(t => t.text.slice(0, 80)),
          html_len: html.length,
          html_first: html ? html.slice(0, 300) : '',
          fetch_err: fetchErr,
        });
      } catch (e) {
        probe.push({ user: u, name: p.name, err: e.message.slice(0, 150).replace(/token=[a-z0-9]+/i, 'token=***') });
      }
    }
  }
  res.json({
    ok: true,
    count: saved.count,
    generated_at: saved.generated_at,
    version_marker: 'NEXA_V42_DEBUG_HTML_LEN',
    ...(debug ? {
      sample: result.updates.slice(0, 3),
      errors: result.errors || [],
      probe: probe?.map(p => ({
        user: p.user,
        name: p.name,
        count: p.count,
        sample_text: p.sample_text,
        html_len: p.html_len,
        html_first: p.html_first,
        fetch_err: p.fetch_err,
        // 过滤敏感信息,只保留前 80 字符
        err: p.err ? p.err.replace(/token=[a-z0-9]+/i, 'token=***').slice(0, 120) : undefined,
      })),
    } : {}),
  });
}

// ── GET /api/refresh-papers ────────────────────────────────
async function handleRefreshPapers(req, res) {
  console.log('[refresh-papers] 抓取 arXiv…');
  const result = await sources.fetchArxivPapers();
  const saved = await store.setPapers(result);
  console.log(`[refresh-papers] 完成,共 ${saved.count} 篇`);
  res.json({ ok: true, count: saved.count, generated_at: saved.generated_at });
}

// ── GET /api/summarize ─────────────────────────────────────
async function handleSummarize(req, res) {
  const [updates, papers] = await Promise.all([store.getUpdates(), store.getPapers()]);
  const u = updates.updates || [];
  const p = papers.papers || [];
  if (!u.length && !p.length) {
    return res.status(400).json({ ok: false, error: '请先点击「刷新全部」抓取推文和论文' });
  }
  console.log(`[summarize] 基于 ${u.length} 条推文 + ${p.length} 篇论文生成总结…`);
  const prompt = buildSummaryPrompt(u, p);
  const raw = await callMinimax([{ role: 'user', content: prompt }], { maxTokens: 4000, temperature: 0.3 });
  const summary = stripThinking(raw);
  console.log('[summarize] raw length:', (raw||'').length, '-> stripped:', summary.length, 'raw_end:', (raw||'').slice(-80));
  if (!summary) {
    return res.status(500).json({ ok: false, error: 'AI 返回为空', raw_preview: (raw||'').slice(0,500) });
  }
  const saved = await store.setSummary({ summary, source_counts: { updates: u.length, papers: p.length } });
  res.json({ ok: true, generated_at: saved.generated_at });
}

// ── GET /api/summary ───────────────────────────────────────
async function handleGetSummary(req, res) {
  const summary = await store.getSummary();
  res.setHeader('Cache-Control', 'no-store');
  res.json(summary);
}

// ── POST /api/chat ─────────────────────────────────────────
async function handleChat(req, res) {
  const body = req.body || {};
  const question = (body.question || '').trim();
  if (!question) return res.status(400).json({ ok: false, error: '问题不能为空' });
  const history = body.history || [];
  const [updates, papers, summary] = await Promise.all([
    store.getUpdates(), store.getPapers(), store.getSummary(),
  ]);
  const messages = buildChatMessages(
    updates.updates || [], papers.papers || [], summary.summary || '',
    history, question,
  );
  const raw = await callMinimax(messages, { maxTokens: 2000, temperature: 0.5 });
  const answer = stripThinking(raw);
  if (!answer) return res.status(500).json({ ok: false, error: 'AI 返回为空' });
  res.json({ ok: true, answer });
}

// ── Prompts ────────────────────────────────────────────────
function buildSummaryPrompt(updates, papers) {
  const lines = [
    '你是 NEXA Daily 的 AI 编辑。请根据以下今日 AI 领域推文和论文,生成一份中文总结报告。',
    '【重要】请直接输出总结正文,不要输出任何思考、分析或解释过程。',
    '',
    '要求:',
    '1. 挑选出 3-5 条最值得关注的推文动态,简述其内容及为什么重要',
    '2. 挑选出 2-3 篇最值得读的论文,简述核心贡献',
    '3. 用中文输出,语气专业简洁,像一份日报简报',
    '4. 总字数控制在 400 字以内',
    '5. 格式: 先写一个总体概述(1-2句),然后用 ### 关注动态 和 ### 论文推荐 两个小标题分开',
    '',
  ];
  if (updates.length) {
    lines.push('--- 今日推文动态 ---');
    for (const u of updates.slice(0, 20)) lines.push(`[${u.author} @${u.username}] ${(u.text || '').slice(0, 300)}`);
  }
  if (papers.length) {
    lines.push('\n--- 今日论文 ---');
    for (const p of papers.slice(0, 12)) lines.push(`《${p.title}》: ${(p.subtitle || '').slice(0, 200)}`);
  }
  return lines.join('\n');
}

function buildChatMessages(updates, papers, summary, history, question) {
  const today = new Date().toISOString().slice(0, 10);
  const sys = [
    `你是 NEXA Daily 的 AI 助手,名叫 NEXA。今天是 ${today}。`,
    '【重要】直接回答用户问题,不要输出思考、分析或解释过程。',
    '你的职责是基于今日 AI 领域的推文和论文,回答用户的问题。',
    '回答要求:',
    '1. 用中文回答,语气友好专业,像一位博学的同事在跟用户聊',
    '2. 回答要具体,引用今日推文/论文的内容,不要泛泛而谈',
    '3. 如果用户问的概念今日推文/论文中提到,优先用这些内容解释',
    '4. 如果用户问的是初学者问题(如何入门),用通俗语言并给出今天内容中适合新手的部分',
    '5. 回答控制在 300 字以内,除非用户明确要求长文',
    '6. 必要时使用 markdown 格式:**加粗** 强调重点,适当分行',
  ].join('\n');
  let ctx = '\n\n--- 今日 AI 总结 ---\n' + ((summary || '').slice(0, 1500) || '(尚未生成)');
  if (updates.length) {
    ctx += '\n\n--- 今日推文 (前 25 条) ---';
    for (const u of updates.slice(0, 25)) ctx += `\n[${u.author || ''}] ${(u.text || '').slice(0, 200)}`;
  }
  if (papers.length) {
    ctx += '\n\n--- 今日论文 (前 10 篇) ---';
    for (const p of papers.slice(0, 10)) ctx += `\n《${p.title || ''}》: ${(p.subtitle || '').slice(0, 150)}`;
  }
  const msgs = [{ role: 'system', content: sys + ctx }];
  for (const h of (history || []).slice(-6)) msgs.push(h);
  msgs.push({ role: 'user', content: question });
  return msgs;
}

// ── 路由分发 ──────────────────────────────────────────────
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const url = (req.url || '/').split('?')[0];

  try {
    if (req.method === 'POST' && url === '/api/chat') return await handleChat(req, res);
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    if (url === '/api' || url === '/api/' || url === '/api/data') return await handleData(req, res);
    if (url === '/api/refresh')         return await handleRefresh(req, res);
    if (url === '/api/refresh-papers')  return await handleRefreshPapers(req, res);
    if (url === '/api/summarize')       return await handleSummarize(req, res);
    if (url === '/api/summary')         return await handleGetSummary(req, res);

    res.status(404).json({ error: 'Not found' });
  } catch (e) {
    console.error('[api]', url, e);
    res.status(500).json({ ok: false, error: e.message });
  }
};