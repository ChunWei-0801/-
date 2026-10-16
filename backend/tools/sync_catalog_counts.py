"""Sync existing handbook counts from ownership, screens, and the schema.

    python backend/tools/sync_catalog_counts.py
    python backend/tools/sync_catalog_counts.py --check

Only summary counts are generated. Route identifiers (including historical
catalogue numbers 74/75) and hand-written examples are kept unchanged.
Run sync_schema.py separately after changing data.js fields or relations.
"""

import argparse
from pathlib import Path
import re
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
from app.ownership import MEMBERS, all_routes
from sync_schema import load_schema

FILES = [
    "docs/01-tech-stack-and-api.md", "docs/02-前後端串接契約.md",
    *["frontend/docs/%s.html" % p for p in
      ("index", "api", "restful", "fastapi", "files", "guide", "model")],
]


def chinese(n):
    digits = "零一二三四五六七八九"
    if n < 10:
        return digits[n]
    return (digits[n // 10] if n >= 20 else "") + "十" + (digits[n % 10] if n % 10 else "")


def render(src, total, screens, tables):
    src = re.sub(r"\d+ (支路由|支 API|條路由|ROUTES|API ·)", lambda m: str(total) + " " + m.group(1), src)
    src = re.sub(r"我們寫的 <b>\d+ 支</b>", "我們寫的 <b>%d 支</b>" % total, src)
    src = re.sub(r"後端那 \d+ 支的", "後端那 %d 支的" % total, src)
    src = re.sub(r"誠實檢查我們自己的 \d+ 支", "誠實檢查我們自己的 %d 支" % total, src)
    src = re.sub(r"\d+ SCREENS", "%d SCREENS" % screens, src)
    src = re.sub(r"[一二三四五六七八九十]+個畫面", chinese(screens) + "個畫面", src)
    src = re.sub(r"\d+ TABLES", "%d TABLES" % tables, src)
    src = re.sub(r"\d+ 張表", "%d 張表" % tables, src)
    src = re.sub(r'(<span>資料表</span><b>)\d+( 張</b>)', lambda m: m.group(1) + str(tables) + m.group(2), src)
    for member in MEMBERS:
        n = len(member.routes)
        src = re.sub(re.escape(member.domain) + r" · \d+ 支", "%s · %d 支" % (member.domain, n), src)
        src = re.sub(r'(\| \*\*' + re.escape(member.domain) + r'\*\* \|[^\n]*\| )\d+ 支', lambda m: m.group(1) + str(n) + " 支", src)
        # The FastAPI domain table puts the file list and count on separate
        # lines. Match complete HTML rows using the owned router folder.
        folders = {str(Path(f).parent) + "/" for f in member.files if f.startswith("app/routers/")}
        def table_row(match):
            row = match.group(0)
            if any(folder.removeprefix("app/") in row for folder in folders):
                row = re.sub(r">\d+ 支</td>", ">%d 支</td>" % n, row)
            return row
        src = re.sub(r"<tr\b[^>]*>.*?</tr>", table_row, src, flags=re.S)
    return src


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    total = len(list(all_routes()))
    app = (REPO / "frontend/js/app.js").read_text()
    routes = re.search(r"var ROUTES = \{(.*?)\};", app, re.S)
    if not routes:
        raise RuntimeError("找不到前端 ROUTES，未改寫文件")
    screens = len(re.findall(r"[\w']+\s*:", routes.group(1)))
    tables = len(load_schema()[0])
    stale = []
    for rel in FILES:
        path = REPO / rel
        old = path.read_text()
        new = render(old, total, screens, tables)
        if new != old:
            stale.append(rel)
            if not args.check:
                path.write_text(new)
    print("API %d · 畫面 %d · 資料表 %d" % (total, screens, tables))
    print(("需要同步：" if args.check else "已更新：") + "、".join(stale) if stale else "摘要數量與程式一致")
    return int(bool(stale) and args.check)


if __name__ == "__main__":
    raise SystemExit(main())
