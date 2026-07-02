#!/usr/bin/env python3
"""从 nitter.net RSS 抓取关注列表中每位专家的最近推文,生成 updates.json。

依赖: cloudscraper, beautifulsoup4
    pip3 install cloudscraper beautifulsoup4
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any

import cloudscraper
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data.json"
OUT_FILE = ROOT / "updates.json"

TIMEOUT = 20
PER_USER_LIMIT = 5

_scraper: cloudscraper.CloudScraper | None = None


def get_scraper() -> cloudscraper.CloudScraper:
    global _scraper
    if _scraper is None:
        _scraper = cloudscraper.create_scraper()
    return _scraper


def load_experts() -> list[dict[str, str]]:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return data.get("people", [])


def fetch_user_tweets(username: str) -> list[dict[str, Any]]:
    """通过 nitter.net RSS 抓取最近推文。"""
    url = f"https://nitter.net/{username}/rss"
    try:
        r = get_scraper().get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            print(f"  [{username}] HTTP {r.status_code}", file=sys.stderr)
            return []
    except Exception as e:
        print(f"  [{username}] 请求失败: {e}", file=sys.stderr)
        return []

    # 解析 RSS XML
    try:
        root = ET.fromstring(r.text)
    except ET.ParseError as e:
        print(f"  [{username}] RSS 解析失败: {e}", file=sys.stderr)
        return []

    ns = {"dc": "http://purl.org/dc/elements/1.1/"}
    items: list[dict[str, Any]] = []

    for item in root.findall(".//item"):
        if len(items) >= PER_USER_LIMIT:
            break

        title = item.findtext("title") or ""
        link = item.findtext("link") or ""
        desc = item.findtext("description") or ""
        pub_date = item.findtext("pubDate") or ""

        # 标题通常是 "@username: tweet text..."
        # 提取纯文本
        text = title
        if text.startswith(f"@{username}:"):
            text = text[len(username) + 2:].strip()

        # 清理 HTML 标签
        text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
        if not text:
            text = BeautifulSoup(desc, "html.parser").get_text(" ", strip=True)
        if not text:
            continue

        # 转换日期格式
        try:
            when = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %Z").strftime("%m.%d %H:%M")
        except (ValueError, TypeError):
            try:
                when = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S GMT").strftime("%m.%d %H:%M")
            except (ValueError, TypeError):
                when = pub_date or ""

        items.append({
            "text": text[:500],
            "link": link,
            "time": when,
        })

    return items


def main() -> int:
    experts = load_experts()
    if not experts:
        print("data.json 里没有 people 列表", file=sys.stderr)
        return 1

    print(f"开始抓取 {len(experts)} 位专家的最近动态…")
    all_updates: list[dict[str, Any]] = []

    for p in experts:
        # 从 url 里提取用户名
        m = re.search(r"xcancel\.com/([^/?#]+)", p.get("url", ""))
        username = m.group(1) if m else ""
        if not username:
            continue
        print(f"  → {username}")
        tweets = fetch_user_tweets(username)
        for t in tweets:
            all_updates.append({
                "author": p["name"],
                "username": username,
                "url": p.get("url", ""),
                "text": t["text"],
                "link": t["link"],
                "time": t["time"],
            })

    all_updates.sort(key=lambda x: x.get("time") or "", reverse=True)

    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "count": len(all_updates),
        "updates": all_updates,
    }
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成,共 {len(all_updates)} 条 → {OUT_FILE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())