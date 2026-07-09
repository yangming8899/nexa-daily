# NEXA Daily · 老师讲给小白听的复盘

> 写给你(Mason,设计师,懂一点 Transformer)的版本。
> 目标:**让你下次看到一个 AI 写的全栈项目,能 5 分钟看懂脉络**。
> 不会用大词,只用人话 + 类比。

---

## 0 · 这个项目到底是干啥的(一句话)

每天自动抓一群 AI 大佬的推特 + arXiv 最新论文 → 用 AI 总结成中文日报 → 展示在一个网页上。

类比:你雇了一个**信息编辑小助理**,每天早上把报纸头条翻译 + 总结好,放在你桌上。

---

## 1 · 大脑里的全景图(先记这张图,后面所有代码都只是它的零件)

```
┌────────────────────┐         ┌──────────────────────┐
│  你看到的网页       │  ←────  │  Vercel 云服务器     │
│  (前端 index.html) │  问/答  │  (后端 api/*.js)     │
└────────────────────┘         └──────────────────────┘
        ↑                                ↓
   你点按钮                        去外面抓数据 / 调 AI
                                           ↓
                          ┌────────────────────────────────┐
                          │  · nitter.net  (推特镜像)      │
                          │  · arxiv.org    (论文)         │
                          │  · MiniMax M3   (大模型 API)   │
                          │  · scrape.do    (代理,防封 IP) │
                          │  · Vercel KV    (记忆)         │
                          └────────────────────────────────┘

每天 0/6/12/18 点,GitHub Actions 还会自动跑一遍抓推文,推到仓库里
(相当于"小助理"每天倒班 4 次,提前把报纸买好)
```

记这个:**前端(看到的画面)+ 后端(干活的代码)+ 外部数据源(原料)+ 定时任务(钟点工)**——四块。

---

## 2 · 项目文件夹逐个看(跟着一行行读)

```
AI web/
├── api/                ← 后端(云端函数)
│   └── [[...slug]].js     单文件 catch-all,所有 API 路由都在这里
├── lib/                ← 后端共享工具箱
│   ├── store.js           记忆(L1 内存 + L2 KV)
│   ├── sources.js         抓数据(推特、arXiv)
│   └── minimax.js         调大模型
├── config/             ← 你想改的配置(关注谁、精选论文)
│   ├── people.json
│   └── papers.json
├── public/             ← 前端
│   └── index.html         一个 HTML 文件包了所有 CSS + JS(单页)
├── scripts/            ← 定时任务的脚本
│   └── fetch.mjs          GitHub Actions 跑这个
├── data/
│   └── cache.json         抓回来的"今日报纸"快照
├── .github/workflows/  ← GitHub 自动跑任务的说明书
│   └── fetch-tweets.yml
├── vercel.json         ← 告诉 Vercel:这是怎么部署的
└── package.json        ← 依赖(其实只有 vercel 一项,后端用 Node 内置)
```

**设计原则**:`config/` 改配置 + `lib/` 改能力 + `api/` 改接口 + `public/` 改界面。
四个文件夹各管一摊,互不打架。这就是**"模块化"**——听起来高大上,本质就是**"把文件夹分清楚"**。

---

## 3 · 前端 `public/index.html` 是怎么工作的

这是个**单页应用 (SPA)**,所有 HTML + CSS + JS 都在**一个文件**里。
打开浏览器→加载这个文件→JS 在你电脑上把页面拼出来,再去后端拿数据。

打开 [public/index.html](file:///Users/mason/Documents/trae_projects/AI%20web/public/index.html),分三段读:

### 3.1 第 13–1230 行:CSS(样式)
- 全部写在 `<style>` 标签里,没有外部 CSS 文件
- 用了 3 个字体:Fraunces(衬线体,大标题)、Inter(正文)、JetBrains Mono(代码/小字)
- 主色是**米黄底 + 橙色点缀**,高级感拉满——这是设计出身的人一眼能看懂的

### 3.2 第 1232–1466 行:HTML(骨架)
就是几个 `<section>` 块:
- `Updates` 今日推文列表
- `Focus` 关注的人卡片
- `Papers` 论文卡片
- 浮窗:AI 总结 modal、收藏夹 modal、聊天面板、喂猫小游戏

**重点:HTML 只是空壳**,所有内容都是 JS 后填的。

### 3.3 第 1469–2796 行:JS(大脑)
打开浏览器按 F12 控制台看的就是这部分。

几个关键函数记一下名字就行(下面会讲流程):

| 函数 | 干啥 |
|---|---|
| `loadAll()` | 一进页面就跑,从 `/api/data` 拉所有数据 |
| `doRefreshAll()` | 点"刷新全部"按钮跑,触发两个后端 API |
| `doSummarize()` | 点"✨ AI 总结"按钮跑,调 `/api/summarize` |
| `sendChat()` | 在聊天框发问,调 `/api/chat` |
| `renderUpdates()` | 把数据画成列表 |
| `translateText()` | **直接走 Google 翻译的免费接口**(浏览器里) |

数据流非常单纯:
```
打开页面 → loadAll() → fetch('/api/data') → 拿到 JSON → 渲染
点刷新  → fetch('/api/refresh') → 拿到 ok → 再 loadAll()
```

---

## 4 · 后端 `api/[[...slug]].js` 是怎么工作的

Vercel 的一个怪规矩:**`api/` 目录里每个 `.js` 文件 = 一个云函数**。
但这个项目只有 1 个文件,文件名是 `[[...slug]].js`,这是 Vercel 的"**catch-all**"语法。
意思是:**所有 `/api/xxx` 请求,都先过这个文件**,然后自己在里面用 `if` 分流。

类比:小区只有一个门卫,所有快递都先到门卫这儿,门卫看一眼收件人再转。

打开 [api/[[...slug]].js](file:///Users/mason/Documents/trae_projects/AI%20web/api/[[...slug]].js),最后 30 行就是路由分流:

```js
if (url === '/api/data')         return handleData(req, res);
if (url === '/api/refresh')      return handleRefresh(req, res);
if (url === '/api/refresh-papers') return handleRefreshPapers(req, res);
if (url === '/api/summarize')    return handleSummarize(req, res);
// ...
```

每个 `handleXxx` 函数都是 `async (req, res) => { ... }`,写法和 Express 一样。

### 4.1 完整后端 API 清单(你心里要有这张表)

| 路径 | 方法 | 干啥 | 在哪 |
|---|---|---|---|
| `/api/data` | GET | 一站式:返回关注列表 + 推文 + 论文 + 总结 | api/[[...slug]].js L43 |
| `/api/refresh` | GET | 抓推文(优先从 GitHub 拉,本地兜底) | L85 |
| `/api/refresh-papers` | GET | 抓 arXiv 论文 | L139 |
| `/api/summarize` | GET | AI 总结今日推文+论文 | L148 |
| `/api/chat` | POST | AI 问答(可传 history) | L184 |

### 4.2 关键概念:**Prompt(提示词)**

看 [api/[[...slug]].js](file:///Users/mason/Documents/trae_projects/AI%20web/api/[[...slug]].js#L203-L254),两个函数:
- `buildSummaryPrompt()` — 把推文+论文塞进一个字符串,告诉大模型"你是 AI 编辑,总结一下"
- `buildChatMessages()` — 把今日内容 + 用户问题拼成 messages 数组发给大模型

**这就是"调大模型"的全部**:把你想让它干的事 + 它需要的素材拼成一段文字,扔给它,它返回文字。
和 ChatGPT 网页版一样,只不过 API 让你能程序化地调。

**Transformer 知识点的体现**:
大模型 API 的输入/输出都是 `messages` 数组,每条消息有 `role`(system / user / assistant)和 `content`。
- system = 给模型的"人设/规则"
- user = 用户的提问
- assistant = 模型的回复

模型在内部就是一个超大的 Transformer:每个 token 看完前面所有 token,预测下一个 token 是啥。
你给它 messages,它就一段段往下接。

---

## 5 · 抓数据:怎么"偷"推特

这一段最反直觉,展开讲。

### 5.1 为什么不能直接抓 twitter.com?
- 推特封第三方抓取,你 IP 一上去就被 403
- 所以走 **nitter.net** —— 一个开源的推特镜像,前端渲染推文
- 镜像也不稳,所以代码里写了**两个镜像**轮流试

### 5.2 为什么还要 `scrape.do`?
- Vercel 的服务器 IP 是数据中心,**所有数据中心 IP 都被推特拉黑了**
- `scrape.do` 是个**代理服务**:你 → scrape.do(住宅 IP) → nitter
- 代理还能让 nitter 觉得是"真人浏览"

### 5.3 抓回来的 HTML 怎么变成推文?
看 [lib/sources.js](file:///Users/mason/Documents/trae_projects/AI%20web/lib/sources.js#L176-L270),`parseNitterHtml()`:
1. **正则切片**:把一大坨 HTML 切成"一条一条推文"
2. **严格过滤作者**:`nitter` 首页会混着"你关注的人"和"他转发的人",必须**只保留目标用户本人**的(不然你关注 Karpathy,结果把别人回复 Karpathy 的也算进来了)
3. **扔掉转推/广告/置顶**
4. **提取正文/时间/链接**

**这就是"爬虫"**:抓 HTML → 切片 → 提取 → 清洗。
没有任何 AI 成分,纯正则 + 字符串处理。

### 5.4 抓 arXiv 论文
简单得多,直接订阅 arXiv 的 **RSS**(就是给机器看的"新闻订阅"):
```
https://rss.arxiv.org/rss/cs.AI
```
RSS 是 XML 格式,解析起来比 HTML 简单 10 倍。

---

## 6 · 怎么"记住"数据:Vercel KV + 内存双层缓存

Vercel 的云函数有个坑:**冷启动**——隔一段时间不访问,下次访问时函数被"重置",所有变量清零。
所以你不能把"今日推文"放在一个全局变量里,不然一冷启就丢了。

看 [lib/store.js](file:///Users/mason/Documents/trae_projects/AI%20web/lib/store.js):

```
读:  L1 内存(快) → 没找到?读 L2 Vercel KV(也快) → 还没?用 seed
写:  同时写 L1 + L2(不等 KV 返回,不阻塞 API)
```

**L1 = 内存 Map**(就是 `const cache = { updates: null, ... }`)
**L2 = Vercel KV**(一个托管的 Redis,在云上,所有实例共享,永久存储)

**为什么这样设计**:
- L1 极快,但实例重启就丢
- L2 慢一丁点(网络请求),但持久
- 先查 L1,99% 命中,体验如丝般顺滑
- 偶尔冷启动,L2 兜住,数据不丢

这是一个非常典型的"**多级缓存**"模式,大厂后端天天用。

---

## 7 · 调大模型:[lib/minimax.js](file:///Users/mason/Documents/trae_projects/AI%20web/lib/minimax.js)

**核心就是一个 HTTPS POST 请求**,60 行代码。

```js
const req = https.request({
  host: 'api.minimax.chat',
  path: '/v1/chat/completions',
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + API_KEY, ... },
}, ...);
```

跟调 OpenAI / Claude / DeepSeek 是一模一样的格式——因为它们都遵循 **OpenAI API 规范**。
也就是说:**以后想换模型,改两行就行**(host + model 名字)。

`stripThinking()` 是为了剥掉大模型输出里的"思考过程"(`<think>...</think>`),只留正文。

---

## 8 · 定时任务:GitHub Actions

打开 [.github/workflows/fetch-tweets.yml](file:///Users/mason/Documents/trae_projects/AI%20web/.github/workflows/fetch-tweets.yml):

```yaml
on:
  schedule:
    - cron: '0 0,6,12,18 * * *'  # 每天 0/6/12/18 点(UTC)
```

GitHub 每天自动帮你跑 `node scripts/fetch.mjs`,抓完推文后 **commit + push** 到仓库的 `data/cache.json`。

**为什么不用 Vercel 的定时任务?**
- Vercel Cron 要钱 + 调度不稳
- GitHub Actions 每月 2000 分钟免费,稳如老狗

**前端怎么拿到这份定时抓的数据?**
看 [api/[[...slug]].js](file:///Users/mason/Documents/trae_projects/AI%20web/api/[[...slug]].js#L96):
```js
const ghUrl = 'https://raw.githubusercontent.com/yangming8899/nexa-daily/main/data/cache.json';
const r = await fetch(ghUrl);
```
**直接拉 GitHub 上的 raw 文件**!这样:
- 不用数据库
- 不花钱
- 用户打开网页就能看到 GitHub Actions 抓的最新版

很巧的 hack。

---

## 9 · 几个"彩蛋"小功能,简单讲一下原理

| 功能 | 文件 | 原理 |
|---|---|---|
| **翻译** | public/index.html `translateText()` | 浏览器直接 fetch Google 翻译的免费接口,完全走后端零负担 |
| **收藏 ⭐** | public/index.html `toggleFavorite()` | `localStorage` 存到用户浏览器本地,不用后端 |
| **自动分类** | public/index.html `autoCategorize()` | 一堆正则,匹配"具身/AGI/多模态..."关键词打标签 |
| **喂猫游戏** | public/index.html `_dropCheese()` | 纯 CSS 动画(transition)+ JS 定时器(`setTimeout`) |
| **AI 总结里可点击跳转** | `findMatchingSource()` | 总结里的"**DeepSeek-V3**"和论文列表做关键词匹配,生成跳转链接 |

---

## 10 · 部署:从"我电脑上能跑"到"所有人都能访问"

整个流程(对应 [DEPLOY.md](file:///Users/mason/Documents/trae_projects/AI%20web/DEPLOY.md)):

```
1. 写代码 → 本地
2. git push → GitHub
3. Vercel 自动检测到 push → 拉代码 → 打包部署
4. 给你一个 https://xxx.vercel.app 网址
5. 别人访问网址 → Vercel 路由 /api/* 到云函数 → 返回 JSON
                → 路由 /* 到 public/index.html
```

**关键文件 [vercel.json](file:///Users/mason/Documents/trae_projects/AI%20web/vercel.json)**:
```json
{
  "version": 2,
  "functions": {
    "api/*.js": { "maxDuration": 60, "memory": 1024 }
  }
}
```
告诉 Vercel:**api/ 里的 JS 是云函数,每个最多跑 60 秒、1024MB 内存**。
(免费版实际只给 10 秒,所以代码里有 9 秒硬性 timeout)

---

## 11 · 你可能想"动一动"的清单

| 你想改 | 改哪 | 难度 |
|---|---|---|
| 关注新大佬 | `config/people.json` 加一行 | ⭐ |
| 改精选论文 | `config/papers.json` 加一行 | ⭐ |
| 改 AI 总结的语气/格式 | `api/[[...slug]].js` 的 `buildSummaryPrompt()` | ⭐⭐ |
| 换大模型 | `lib/minimax.js` 改 host 和 model | ⭐⭐ |
| 调样式/颜色 | `public/index.html` 顶部 `<style>` 里的 `--accent` 等 CSS 变量 | ⭐ |
| 加重试/换数据源 | `lib/sources.js` | ⭐⭐⭐ |
| 接入真数据库 | `lib/store.js` | ⭐⭐⭐ |

---

## 12 · 看完这份,你应该记住的 12 件事

1. **前端 = 一个 HTML 文件**(`public/index.html`),JS 在浏览器里画页面
2. **后端 = 一个 catch-all 云函数**(`api/[[...slug]].js`),用 `if` 分流
3. **配置 = 两个 JSON**(`config/people.json` + `config/papers.json`),改配置不动代码
4. **抓推特 = nitter 镜像 + scrape.do 代理 + 正则解析**
5. **抓论文 = arXiv RSS**(最简单)
6. **调大模型 = HTTPS POST + OpenAI 格式 + prompt 字符串拼接**
7. **存储 = 内存 L1 + Vercel KV L2 双层缓存**
8. **定时 = GitHub Actions 每天 4 次,抓完 commit 到仓库**
9. **部署 = git push → Vercel 自动构建 → 给你网址**
10. **翻译 = 浏览器直连 Google 免费 API,不过后端**
11. **收藏 = localStorage 存在用户本地**
12. **原则 = 文件夹各管一摊,新功能 = 新文件,改配置 = 改 JSON**

---

## 13 · 给你的"内功心法"(脱离这个项目也适用)

### 13.1 全栈项目的"四块拼图"模型
**前端 / 后端 / 数据源 / 定时任务**——任何 web 项目都是这四块,只是拼法不同。
下次看到一个新项目,先找这四块在哪,你就看懂一半了。

### 13.2 "AI 写的代码"和"人写的代码"的区别
- AI 写的:文件多、注释多、抽象多(看着高大上)
- 人写的:能省就省、能跑就行(看着糙但稳)
- 这个项目偏前者,但**组织得很好**,是好的 AI 协作产物

### 13.3 学新东西的"5 分钟看懂"技巧
拿到一个陌生项目:
1. **先看 `package.json`** — 依赖是什么,就知道用了啥
2. **再找入口** — 前端找 `index.html`,后端找 `api/` 或 `app.js` / `main.py`
3. **顺着 import/require 走** — 跟一两个调用链,就懂核心
4. **跑起来 + 改一个小东西** — 改个颜色,改个文案,确认你懂了

### 13.4 你设计师出身的优势
- 你对**视觉/交互/排版**的敏感度,远胜 90% 的程序员
- 这个项目里所有的 CSS、配色、间距、动效都是设计活,代码只是实现
- 以后做 AI 项目,你的价值在"**让 AI 写的丑东西变好看**"

---

## 14 · 下次提问模板(直接复制粘贴用)

你下次有问题想问的时候,按这个格式发我:

```
【背景】我想加一个功能:______
【现状】现在项目里有______
【疑问】具体我不懂的是:______
【我已经试过】______(可选)
```

这样我能直接给到点子上,不用反复澄清。

---

**最后一句话**:
这个项目本质上是**"调 API + 拼接字符串 + 展示界面"**。
99% 的 AI 全栈项目都是这个套路。
会了模板,剩下就是填料。
