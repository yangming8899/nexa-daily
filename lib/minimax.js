/**
 * 调用 MiniMax M3 大模型,统一封装。
 * 以后想换模型、加超时、加重试,改这里即可。
 */
const https = require('https');

// 必须通过环境变量注入,不要把 key 写进代码或 git 历史
const API_KEY = process.env.MINIMAX_API_KEY;
if (!API_KEY) {
  console.error('[minimax] 缺少环境变量 MINIMAX_API_KEY,AI 功能将不可用');
}
const API_HOST = 'api.minimax.chat';
const API_PATH = '/v1/chat/completions';

const TIMEOUT_MS = 50_000;

function callMinimax(messages, { maxTokens = 1500, temperature = 0.7, model = 'MiniMax-M3' } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model, messages, max_tokens: maxTokens, temperature,
    });
    const req = https.request({
      host: API_HOST, path: API_PATH, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        }
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) {
          reject(new Error('JSON 解析失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('MiniMax 调用超时')));
    req.write(body);
    req.end();
  });
}

/** 去掉模型输出的思考过程,只留正文 */
function stripThinking(content) {
  if (!content) return '';
  // 优先: 匹配 <think>...</think> 或 <thinking>...</thinking> 之后的部分
  const thinkClose = content.search(/<\/(think|thinking)\s*>/i);
  if (thinkClose >= 0) {
    return content.slice(thinkClose).replace(/<\/(think|thinking)\s*>/i, '').trim();
  }
  // 备选: 第一个 ## 或 ### 标题之前是思考
  const heading = content.search(/(^|\n)(#{1,3})\s/);
  if (heading > 0) {
    return content.slice(heading).trim();
  }
  return content.trim();
}

module.exports = { callMinimax, stripThinking };