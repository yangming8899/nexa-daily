#!/usr/bin/env python3
"""调用 MiniMax M3 模型,根据今日推文和论文生成中文 AI 总结。"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
OUT_FILE = ROOT / "summary.json"
API_KEY = "sk-cp-ui3pUO9CRpDGi01Iy0c_mO4D_QRMouIDQ6I2Omdt6bIwcrSrfmCRxV8iUetwdCDCxu2CesbfyxfPrU3R2acjHCfQBcnnI11X67c_cD5nhsfpkyQ5ayHM09A"
API_URL = "https://api.minimax.chat/v1/chat/completions"
TIMEOUT = 60


def load_data() -> tuple[list[dict], list[dict]]:
    updates = []
    papers = []
    uf = ROOT / "updates.json"
    pf = ROOT / "papers.json"
    if uf.exists():
        data = json.loads(uf.read_text(encoding="utf-8"))
        updates = data.get("updates", [])
    if pf.exists():
        data = json.loads(pf.read_text(encoding="utf-8"))
        papers = data.get("papers", [])
    return updates, papers


def build_prompt(updates: list[dict], papers: list[dict]) -> str:
    lines = ["你是 NEXA Daily 的 AI 编辑。请根据以下今日 AI 领域推文和论文,生成一份中文总结报告。\n"]
    lines.append("要求:")
    lines.append("1. 挑选出 3-5 条最值得关注的推文动态,简述其内容及为什么重要")
    lines.append("2. 挑选出 2-3 篇最值得读的论文,简述核心贡献")
    lines.append("3. 用中文输出,语气专业简洁,像一份日报简报")
    lines.append("4. 总字数控制在 400 字以内")
    lines.append("5. 格式: 先写一个总体概述(1-2句),然后用 ### 关注动态 和 ### 论文推荐 两个小标题分开")
    lines.append("")

    if updates:
        lines.append("--- 今日推文动态 ---")
        for u in updates[:20]:
            lines.append(f"[{u.get('author','')} @{u.get('username','')}] {u.get('text','')[:300]}")
    if papers:
        lines.append("\n--- 今日论文 ---")
        for p in papers[:12]:
            lines.append(f"《{p.get('title','')}》: {p.get('subtitle','')[:200]}")

    return "\n".join(lines)


def call_minimax(prompt: str) -> str | None:
    body = json.dumps({
        "model": "MiniMax-M3",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 1200,
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
        # 去除模型思考过程 (支持 <think>...</think> 和 <thinking>...</thinking>)
        import re
        m = re.search(r'</think\s*>', content, re.IGNORECASE)
        if m:
            content = content[m.end():].lstrip()
        elif "thinking" in content[:50].lower():
            # 备选: 找第一个 ### 或 # 标题(实际总结)
            matches = list(re.finditer(r'(?:^|\n)(#|###)\s', content, re.MULTILINE))
            if matches:
                content = content[matches[-1].start():].lstrip()
        return content
    except Exception as e:
        print(f"MiniMax API 调用失败: {e}", file=sys.stderr)
        # 尝试读取响应体中的错误信息
        if hasattr(e, 'read'):
            try:
                err_body = e.read().decode("utf-8")
                print(f"  响应: {err_body[:500]}", file=sys.stderr)
            except Exception:
                pass
        return None


def main() -> int:
    updates, papers = load_data()
    if not updates and not papers:
        print("没有数据可总结,请先刷新动态和论文", file=sys.stderr)
        return 1

    print(f"正在调用 MiniMax 生成 AI 总结 (基于 {len(updates)} 条推文 + {len(papers)} 篇论文)…")
    prompt = build_prompt(updates, papers)
    summary = call_minimax(prompt)

    if not summary:
        print("AI 总结生成失败", file=sys.stderr)
        return 1

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "summary": summary,
        "source_counts": {"updates": len(updates), "papers": len(papers)},
    }
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"AI 总结已生成 → {OUT_FILE.name}")
    print(f"预览:\n{summary[:200]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())