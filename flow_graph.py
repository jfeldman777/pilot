"""CLI: генерация графа в статический HTML-файл."""

import json
import webbrowser
from pathlib import Path

from graph_core import GraphParams, generate_graph

DEFAULT = GraphParams()


def export_html(result: dict, params: GraphParams, output: str = "flow_graph.html") -> Path:
    nodes = json.dumps(result["nodes"], ensure_ascii=False)
    edges = json.dumps(result["edges"], ensure_ascii=False)
    html = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>body{{margin:0}}#g{{width:100vw;height:100vh}}</style></head>
<body><div id="g"></div><script>
new vis.Network(document.getElementById("g"),
  {{nodes:new vis.DataSet({nodes}), edges:new vis.DataSet({edges})}},
  {{physics:{{enabled:false}}, interaction:{{dragNodes:true,dragView:true,zoomView:true}}}});
</script></body></html>"""
    path = Path(output)
    path.write_text(html, encoding="utf-8")
    return path


def main():
    result = generate_graph(DEFAULT)
    failed = [c for c in result["checks"] if not c["ok"]]
    if failed:
        for c in failed:
            print(f"FAIL: {c['name']}")
        raise SystemExit(1)

    path = export_html(result, DEFAULT)
    print(f"Сохранено: {path}")
    webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
