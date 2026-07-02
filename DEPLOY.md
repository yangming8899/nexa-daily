# NEXA Daily · Vercel 部署版

你自己的 AI 信息聚合页,**部署到 Vercel 一次,所有人通过网址即可访问**,
你不需要一直开着电脑,后续加功能也非常方便。

---

## 快速部署(5 分钟)

### 1. 注册 Vercel
- 打开 https://vercel.com,用 GitHub 账号登录

### 2. 把项目推到 GitHub
```bash
cd "/Users/mason/Documents/trae_projects/AI web"
git init
git add .
git commit -m "init: NEXA Daily v3"
gh repo create nexa-daily --public --source=. --push
```
> 如果没装 `gh`,也可以在 github.com 上手动建仓再 `git push`。

### 3. 在 Vercel 导入
- Vercel 后台 → **Add New Project** → 选择 `nexa-daily` 仓库
- 框架选 **Other** (它会自动识别)
- 点 **Deploy** → 几十秒后会拿到一个网址,例如:
  ```
  https://nexa-daily.vercel.app
  ```
- 把这个网址发给别人就行 🎉

### 4. (可选) 绑定你自己的域名
Vercel → Project → Settings → Domains,按提示加 `nexa.yourdomain.com` 即可。

---

## 本地调试

```bash
# 装 Vercel CLI(只需一次)
npm i -g vercel

# 在项目目录启动本地服务
cd "/Users/mason/Documents/trae_projects/AI web"
vercel dev
```
然后访问 http://localhost:3000

---

## 项目结构

```
AI web/
├── api/                  # 后端 Serverless API(Vercel Function)
│   ├── data.js              GET /api/data          一站式:people + 静态论文 + 当前 updates/papers/summary
│   ├── refresh.js           GET /api/refresh       抓推文(nitter)
│   ├── refresh-papers.js    GET /api/refresh-papers 抓 arXiv 论文
│   ├── summarize.js         GET /api/summarize     AI 生成今日总结
│   ├── summary.js           GET /api/summary       读当前 summary
│   └── chat.js              POST /api/chat         AI 问答
├── lib/                  # 后端共享模块
│   ├── store.js             内存 + 文件缓存(进程级别)
│   ├── sources.js           nitter / arXiv 抓取
│   └── minimax.js           大模型调用封装
├── config/               # 静态配置(以后想扩展只改这里)
│   ├── people.json          关注的人
│   └── papers.json          精选论文(seed)
├── public/               # 前端静态资源
│   └── index.html           单页应用
├── vercel.json           # Vercel 配置
└── package.json
```

---

## 日常维护

### 改关注的人
编辑 `config/people.json`,提交推送,Vercel 自动重新部署。
```json
{ "name": "新名字", "title": "简介", "url": "https://xcancel.com/xxx" }
```

### 改精选论文(没抓 arXiv 时的 fallback)
编辑 `config/papers.json`,提交推送。

### 换大模型 / API Key
1. 修改 `lib/minimax.js` 中的 `API_KEY` 和 `model`
2. **更推荐**:到 Vercel 项目 → Settings → Environment Variables,设:
   ```
   MINIMAX_API_KEY = 你的新 key
   ```
   然后在代码里读 `process.env.MINIMAX_API_KEY`(已写好)

---

## 扩展性(以后加功能)

代码已经按"**新功能 = 新文件**"组织,加功能很简单:

| 想做的事 | 加在哪 | 复杂度 |
|---|---|---|
| 加新的 API 端点 | 在 `api/` 加一个 `.js` 文件,Vercel 自动部署 | 5 分钟 |
| 改关注的人/精选论文 | 改 `config/*.json`,提交 | 1 分钟 |
| 换大模型 | 改 `lib/minimax.js` 或环境变量 | 5 分钟 |
| 加重试/缓存/限流 | 改 `lib/sources.js` 和 `lib/store.js` | 30 分钟 |
| 持久化(代替内存) | 接入 Vercel KV / Upstash Redis,改 `lib/store.js` 一个文件 | 1 小时 |
| 加用户系统/登录 | 加 NextAuth 或 Clerk,新加 `api/auth/*` | 半天 |
| 换前端框架(React/Vue) | 改 `public/`,后端不动 | 半天 |

### 扩展路线建议(人数增长时)

```
1-10 人(现在)        : 当前架构,免费,够用
10-100 人           : + Vercel KV 持久化(避免冷启动丢数据)
100-1000 人         : + Upstash Redis 做缓存层 + 升级 Vercel Pro($20/月)
1000+               : 拆出独立后端服务(Render/Fly.io),前端继续 Vercel
```

---

## 注意事项 / 已知限制

1. **Vercel 免费版限制**:
   - Serverless Function 最多跑 **10 秒**(我们设了 `maxDuration: 60`,实际取决于 plan)
   - 内存缓存冷启动会丢 → 我们做了"种子数据"兜底,网站不会白屏
2. **API Key 安全**: 当前 `lib/minimax.js` 里硬编码了 key,虽然只是个人 demo,
   但建议尽快用 Vercel Environment Variables 替换。
3. **数据持久化**: 当前内存缓存冷启动会清空,如果 Vercel KV 接入前希望保留数据,
   可以临时启用 Vercel Postgres 或将 `data/*.json` 提交进 git(本地 fallback)。
4. **抓取频率**: arXiv / nitter 都有限流,避免短时间内多次点「刷新全部」。

---

## 升级到 v3 之前的旧版本?
- 旧版本(Python 本地)所有文件都保留,可以继续用 `python3 server.py`
- 部署到 Vercel 后,只是新加了一份 `api/` + `public/` + `vercel.json`
- 两者可以共存,不冲突