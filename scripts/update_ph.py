#!/usr/bin/env python3
"""Daily refresh of data/ph-weekly.json for "The Philippines this week".

Runs with the Python standard library only. Updates the parts that come from
free public feeds:
  - peso per US dollar (Yahoo Finance intraday, ExchangeRate-API as backup)
  - PSE index close (Yahoo Finance chart data)
  - five headlines (BusinessWorld and Inquirer Business RSS, titles verbatim)
  - the "updated" date, and drops key dates that have passed

Everything else (BSP policy rate, inflation, regulation watch, key dates) is
edited by hand in the JSON file. If a source fails, the previous value is kept.
"""

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "ph-weekly.json"
MANILA = timezone(timedelta(hours=8))
UA = "Mozilla/5.0 (compatible; BlackfieldPartnersSite/1.0; +https://blackfieldpartners.com)"

FEEDS = [
    ("BusinessWorld", "https://www.bworldonline.com/feed/"),
    ("Inquirer Business", "https://business.inquirer.net/feed"),
]
# Feed categories and title words that mark opinion, features or non-news.
SKIP_CATEGORIES = {"opinion", "editorial", "editorials", "columns", "infographics",
                   "sponsored", "special features", "spotlight", "sports", "arts & leisure",
                   "bw launchpad"}
SKIP_TITLE = re.compile(r"^(opinion|editorial|column|watch|listen|look|in photos|sponsored)\b[:|]?", re.I)
TOP_CATEGORIES = {"top stories", "editors' picks"}
STOPWORDS = set("a an the of to in on for and or at by with from as is are be its it this that "
                "after over into amid vs per new says said may will".split())


def log(msg):
    print(msg, file=sys.stderr)


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def short_date(d):
    return f"{d.strftime('%b')} {d.day}"


def short_time(d):
    return d.strftime("%I:%M %p").lstrip("0")


def peso(old):
    # Intraday market rate first (refreshes through the day), then the once-a-day rate as a backup.
    try:
        d = json.loads(fetch("https://query1.finance.yahoo.com/v8/finance/chart/PHP=X?range=1d&interval=1d"))
        meta = d["chart"]["result"][0]["meta"]
        rate = float(meta["regularMarketPrice"])
        when = datetime.fromtimestamp(int(meta["regularMarketTime"]), MANILA)
        return dict(old, value=f"₱{rate:,.2f}", note=f"Market rate, {short_date(when)}, {short_time(when)}.",
                    source="Yahoo Finance", url="https://finance.yahoo.com/quote/PHP=X/")
    except Exception as e:
        log(f"peso: intraday source failed ({e}), trying daily source")
    try:
        d = json.loads(fetch("https://open.er-api.com/v6/latest/USD"))
        rate = float(d["rates"]["PHP"])
        when = datetime.fromtimestamp(int(d["time_last_update_unix"]), MANILA)
    except Exception as e:  # keep the previous value
        log(f"peso: kept previous value ({e})")
        return old
    return dict(old, value=f"₱{rate:,.2f}", note=f"Market rate, {short_date(when)}.",
                source="ExchangeRate-API", url="https://www.exchangerate-api.com/")


def psei(old):
    try:
        d = json.loads(fetch("https://query1.finance.yahoo.com/v8/finance/chart/PSEI.PS?range=1d&interval=1d"))
        meta = d["chart"]["result"][0]["meta"]
        last, prev = float(meta["regularMarketPrice"]), float(meta["chartPreviousClose"])
        when = datetime.fromtimestamp(int(meta["regularMarketTime"]), MANILA)
    except Exception as e:
        log(f"psei: kept previous value ({e})")
        return old
    change = (last - prev) / prev * 100
    move = "flat" if abs(change) < 0.005 else f"{'up' if change > 0 else 'down'} {abs(change):.2f}%"
    return dict(old, value=f"{last:,.2f}", note=f"Closed {short_date(when)}, {move}.",
                source="Philippine Stock Exchange", url="https://www.pse.com.ph/")


def words(title):
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if w not in STOPWORDS and len(w) > 2}


def headlines(old, now):
    per_source = []
    for name, url in FEEDS:
        try:
            root = ET.fromstring(fetch(url))
        except Exception as e:
            log(f"feed {name}: skipped ({e})")
            continue
        items = []
        for it in root.iter("item"):
            title = re.sub(r"\s*\u2014\s*", ": ", (it.findtext("title") or "").strip())
            link = (it.findtext("link") or "").strip()
            cats = {(c.text or "").strip().lower() for c in it.findall("category")}
            try:
                when = parsedate_to_datetime(it.findtext("pubDate"))
            except Exception:
                continue
            if not title or not link or cats & SKIP_CATEGORIES or SKIP_TITLE.match(title):
                continue
            if now - when > timedelta(hours=48):
                continue
            top = bool(cats & TOP_CATEGORIES)
            items.append({"title": title, "source": name, "url": link, "when": when, "top": top})
        items.sort(key=lambda x: (x["top"], x["when"]), reverse=True)
        per_source.append(items)

    chosen, seen = [], []
    # Alternate between sources, top stories first, skipping near-duplicate stories.
    while len(chosen) < 5 and any(per_source):
        for items in per_source:
            while items:
                cand = items.pop(0)
                w = words(cand["title"])
                if all(len(w & s) / max(1, len(w | s)) < 0.3 for s in seen):
                    chosen.append(cand)
                    seen.append(w)
                    break
            if len(chosen) == 5:
                break
    if len(chosen) < 3:
        log("headlines: too few fresh items, kept previous list")
        return old
    return [{"title": c["title"], "source": c["source"], "url": c["url"]} for c in chosen]


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    now = datetime.now(MANILA)
    today = now.date().isoformat()

    for i, ind in enumerate(data["indicators"]):
        if ind["label"] == "Peso per US dollar":
            data["indicators"][i] = peso(ind)
        elif ind["label"] == "PSE index":
            data["indicators"][i] = psei(ind)

    data["headlines"] = headlines(data["headlines"], now)
    data["dates"] = [d for d in data["dates"] if d.get("until", "9999-12-31") >= today]
    data["updated"] = today
    data["updatedTime"] = short_time(now)  # Manila time, e.g. "9:01 AM"

    DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"updated {DATA.name} for {today}")


if __name__ == "__main__":
    main()
