#!/usr/bin/env python3
"""从 arXiv RSS 抓取最近 AI 热门论文,生成 papers.json。"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
OUT_FILE = ROOT / "papers.json"

FEEDS = [
    "https://rss.arxiv.org/rss/cs.AI",
    "https://rss.arxiv.org/rss/cs.CL",
    "https://rss.arxiv.org/rss/cs.LG",
]
MAX_RESULTS = 12
TIMEOUT = 20


def fetch_feed(url: str) -> list[dict[str, Any]]:
    req = urllib.request.Request(url, headers={"User-Agent": "NEXA-Daily/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            xml_text = resp.read().decode("utf-8")
    except Exception as e:
        print(f"  RSS 请求失败 {url}: {e}", file=sys.stderr)
        return []

    root = ET.fromstring(xml_text)
    items: list[dict[str, Any]] = []

    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip().replace("\n", " ")
        desc = (item.findtext("description") or "").strip().replace("\n", " ")[:300]
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()

        try:
            dt = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %z")
            date_str = dt.strftime("%m.%d")
        except (ValueError, TypeError):
            date_str = pub_date[:10]

        items.append({
            "title": title,
            "subtitle": desc,
            "url": link,
            "date": date_str,
        })

    return items


def main() -> int:
    print("正在从 arXiv RSS 抓取最新 AI 论文…")
    all_papers: list[dict[str, Any]] = []

    for feed_url in FEEDS:
        print(f"  → {feed_url.split('/')[-1]}")
        papers = fetch_feed(feed_url)
        all_papers.extend(papers)
        time.sleep(2)  # 避免触发限流

    if not all_papers:
        print("未获取到论文", file=sys.stderr)
        return 1

    # 按日期倒序,取前 MAX_RESULTS
    all_papers.sort(key=lambda x: x.get("date") or "", reverse=True)
    all_papers = all_papers[:MAX_RESULTS]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(all_papers),
        "papers": all_papers,
    }
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成,共 {len(all_papers)} 篇 → {OUT_FILE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())