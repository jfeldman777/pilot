#!/usr/bin/env python3
"""Render CUSTOMER_LETTER.md → customer-letter.html (static, no CDN)."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MD_PATH = ROOT / "CUSTOMER_LETTER.md"
OUT_PATH = ROOT / "customer-letter.html"

SHELL = """<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Письмо заказчику — MVP</title>
  <link rel="stylesheet" href="home-nav.css">
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: "Segoe UI", Arial, sans-serif; margin: 0; padding: 56px 20px 48px; background: #f5f6f8; color: #222; line-height: 1.6; }}
    .wrap {{ max-width: 820px; margin: 0 auto; }}
    .top-bar {{ display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; font-size: 13px; }}
    .top-bar a {{ color: #1565c0; font-weight: 600; text-decoration: none; }}
    .top-bar a:hover {{ text-decoration: underline; }}
    .top-bar .sep {{ color: #bbb; }}
    #content {{ background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 28px 32px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }}
    #content h1 {{ font-size: 1.65rem; margin-top: 0; color: #283593; border-bottom: 2px solid #e8eaf6; padding-bottom: 10px; }}
    #content h2 {{ font-size: 1.2rem; margin-top: 1.6em; color: #3949ab; }}
    #content h3 {{ font-size: 1.05rem; margin-top: 1.2em; color: #3949ab; }}
    #content table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin: 12px 0; }}
    #content th, #content td {{ border: 1px solid #ddd; padding: 8px 10px; text-align: left; vertical-align: top; }}
    #content th {{ background: #e8eaf6; }}
    #content tr:nth-child(even) td {{ background: #fafafa; }}
    #content code {{ background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.92em; }}
    #content pre {{ background: #263238; color: #eceff1; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }}
    #content a {{ color: #1565c0; }}
    #content hr {{ border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }}
    #content p {{ margin: 0.6em 0; }}
  </style>
</head>
<body>
  <a href="index.html" class="home-btn" title="Выбор входа">⌂</a>
  <div class="wrap">
    <div class="top-bar">
      <a href="index.html">← Вход</a><span class="sep">·</span>
      <a href="start.html">★ Guided demo</a><span class="sep">·</span>
      <a href="eng-large-map.html?demo=1">Автодемо</a><span class="sep">·</span>
      <a href="roadmap.html">Roadmap</a>
    </div>
    <div id="content">
{body}
    </div>
  </div>
</body>
</html>
"""


def inline_format(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(
        r"(https?://[^\s<]+)",
        r'<a href="\1" target="_blank" rel="noopener">\1</a>',
        text,
    )
    return text


def parse_md(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("### "):
            out.append(f"<h3>{inline_format(line[4:])}</h3>")
            i += 1
            continue
        if line.startswith("## "):
            out.append(f"<h2>{inline_format(line[3:])}</h2>")
            i += 1
            continue
        if line.startswith("# "):
            out.append(f"<h1>{inline_format(line[2:])}</h1>")
            i += 1
            continue
        if line.strip() == "---":
            out.append("<hr>")
            i += 1
            continue
        if line.startswith("|"):
            rows: list[str] = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            if len(rows) >= 2:
                out.append("<table>")
                header = [c.strip() for c in rows[0].strip("|").split("|")]
                out.append("<tr>" + "".join(f"<th>{inline_format(c)}</th>" for c in header) + "</tr>")
                for row in rows[2:]:
                    cells = [c.strip() for c in row.strip("|").split("|")]
                    out.append("<tr>" + "".join(f"<td>{inline_format(c)}</td>" for c in cells) + "</tr>")
                out.append("</table>")
            continue
        if line.startswith("    "):
            block: list[str] = []
            while i < len(lines) and (lines[i].startswith("    ") or lines[i].strip() == ""):
                if lines[i].strip():
                    block.append(lines[i][4:])
                i += 1
            out.append("<pre>" + html.escape("\n".join(block)) + "</pre>")
            continue
        if not line.strip():
            i += 1
            continue
        out.append(f"<p>{inline_format(line)}</p>")
        i += 1
    return "\n".join(out)


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT_PATH
    md = MD_PATH.read_text(encoding="utf-8")
    body = parse_md(md)
    out.write_text(SHELL.format(body=body), encoding="utf-8")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
