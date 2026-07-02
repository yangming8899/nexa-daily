# NEXA Daily · Vercel 部署版

> AI Pulse, Filtered for You.
> 部署一次,所有人通过网址即可访问,你不需要一直开电脑。

## 🎯 两种使用方式

### 方式 A:Vercel 部署(推荐,公开分享给别人)

完整步骤见 [DEPLOY.md](./DEPLOY.md),核心 3 步:
1. 把项目推到 GitHub
2. 在 [vercel.com](https://vercel.com) 导入仓库,点 Deploy
3. 把生成的网址发给别人

### 方式 B:本地自己用(老方式,保留兼容)

```bash
cd "/Users/mason/Documents/trae_projects/AI web"
pip3 install cloudscraper beautifulsoup4
python3 server.py
# 浏览器打开 http://127.0.0.1:8765/
```

## 📁 项目结构

```
AI web/
├── api/                  # 后端 Serverless API
│   ├── data.js              GET /api/data          一站式数据
│   ├── refresh.js           GET /api/refresh       抓推文
│   ├── refresh-papers.js    GET /api/refresh-papers 抓 arXiv
│   ├── summarize.js         GET /api/summarize     AI 总结
│   ├── summary.js           GET /api/summary       读当前总结
│   └── chat.js              POST /api/chat         AI 问答
├── lib/                  # 后端共享模块
│   ├── store.js             内存 + 文件缓存
│   ├── sources.js           nitter / arXiv 抓取
│   └── minimax.js           大模型调用封装
├── config/               # 静态配置(以后改关注的人只改这里)
│   ├── people.json
│   └── papers.json
├── public/               # 前端
│   └── index.html
├── vercel.json
├── DEPLOY.md             ← 详细部署 + 扩展指南
├── server.py             ← 旧 Python 本地服务器(保留)
├── update.py             ← 旧 Python 抓推文脚本(保留)
├── fetch_papers.py       ← 旧 Python 抓论文脚本(保留)
├── summarize.py          ← 旧 Python AI 总结脚本(保留)
└── chat.py               ← 旧 Python AI 问答脚本(保留)
```

## 🔧 改关注的人 / 加功能

详见 [DEPLOY.md](./DEPLOY.md) 的「日常维护」和「扩展性」章节。

常见场景:
- 改关注列表:编辑 `config/people.json` → 提交 → Vercel 自动部署
- 加重试 / 换数据源:改 `lib/sources.js`
- 接持久化(Redis/Vercel KV):改 `lib/store.js`
- 加新 API:在 `api/` 加新 `.js` 文件