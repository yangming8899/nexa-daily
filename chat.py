#!/usr/bin/env python3
"""AI 问答:基于今日 updates/papers/summary + 用户问题,调用 MiniMax M3 回答。"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
API_KEY = "sk-cp-ui3pUO9CRpDGi01Iy0c_mO4D_QRMouIDQ6I2Omdt6bIwcrSrfmCRxV8iUetwdCDCxu2CesbfyxfPrU3R2acjHCfQBcnnI11X67c_cD5nhsfpkyQ5ayHM09A"
API_URL = "https://api.minimax.chat/v1/chat/completions"
TIMEOUT = 60


def load_data() -> tuple[list[dict], list[dict], str]:
    updates, papers, summary = [], [], ""
    uf = ROOT / "updates.json"
    pf = ROOT / "papers.json"
    sf = ROOT / "summary.json"
    if uf.exists():
        updates = json.loads(uf.read_text(encoding="utf-8")).get("updates", [])
    if pf.exists():
        papers = json.loads(pf.read_text(encoding="utf-8")).get("papers", [])
    if sf.exists():
        s = json.loads(sf.read_text(encoding="utf-8"))
        summary = s.get("summary", "")
    return updates, papers, summary


def build_context(updates, papers, summary, history, question) -> list[dict]:
    sys_prompt = (
        "你是 NEXA Daily 的 AI 助手,名叫 NEXA。今天是 " +
        str(__import__('datetime').datetime.now().strftime('%Y-%m-%d')) + "。\n"
        "你的职责是基于今日 AI 领域的推文和论文,回答用户的问题。\n"
        "回答要求:\n"
        "1. 用中文回答,语气友好专业,像一位博学的同事在跟用户聊\n"
        "2. 回答要具体,引用今日推文/论文的内容,不要泛泛而谈\n"
        "3. 如果用户问的概念今日推文/论文中提到,优先用这些内容解释\n"
        "4. 如果用户问的是初学者问题(如何入门),用通俗语言并给出今天内容中适合新手的部分\n"
        "5. 回答控制在 300 字以内,除非用户明确要求长文\n"
        "6. 必要时使用 markdown 格式:**加粗** 强调重点,适当分行\n"
    )
    ctx = "\n\n--- 今日 AI 总结 ---\n" + (summary[:1500] if summary else "(尚未生成)")
    if updates:
        ctx += "\n\n--- 今日推文 (前 25 条) ---"
        for u in updates[:25]:
            ctx += f"\n[{u.get('author','')}] {u.get('text','')[:200]}"
    if papers:
        ctx += "\n\n--- 今日论文 (前 10 篇) ---"
        for p in papers[:10]:
            ctx += f"\n《{p.get('title','')}》: {p.get('subtitle','')[:150]}"
    sys_prompt += ctx

    msgs = [{"role": "system", "content": sys_prompt}]
    # 追加历史对话(最后 6 轮)
    for h in history[-6:]:
        msgs.append(h)
    msgs.append({"role": "user", "content": question})
    return msgs


def call_minimax(messages) -> str | None:
    body = json.dumps({
        "model": "MiniMax-M3",
        "messages": messages,
        "max_tokens": 1500,
        "temperature": 0.7,
    }).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        # 去思考
        import re
        m = re.search(r'</think\s*>', content, re.IGNORECASE)
        if m:
            content = content[m.end():].lstrip()
        elif "thinking" in content[:50].lower():
            matches = list(re.finditer(r'(?:^|\n)(#|###)\s', content, re.MULTILINE))
            if matches:
                content = content[matches[-1].start():].lstrip()
        return content
    except Exception as e:
        print(f"MiniMax API 调用失败: {e}", file=sys.stderr)
        if hasattr(e, 'read'):
            try:
                err_body = e.read().decode("utf-8")
                print(f"  响应: {err_body[:500]}", file=sys.stderr)
            except Exception:
                pass
        return None


def main() -> int:
    # 从 stdin 读取 JSON: { question, history }
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(f"请求 JSON 解析失败: {e}", file=sys.stderr)
        return 1
    question = req.get("question", "").strip()
    history = req.get("history", [])
    if not question:
        print("问题不能为空", file=sys.stderr)
        return 1

    updates, papers, summary = load_data()
    print(f"基于 {len(updates)} 推文 + {len(papers)} 论文 + 总结,回答: {question[:60]}…", file=sys.stderr)

    messages = build_context(updates, papers, summary, history, question)
    answer = call_minimax(messages)
    if not answer:
        print("AI 回答生成失败", file=sys.stderr)
        return 1

    print(answer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
