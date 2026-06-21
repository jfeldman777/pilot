"""Веб-интерфейс: параметры слева, граф справа."""

import os
import webbrowser
from threading import Timer

from flask import Flask, jsonify, render_template, request

from graph_core import GraphParams, GraphState, generate_graph, rebalance_graph, show_weakest_case

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/generate")
def api_generate():
    data = request.get_json(silent=True) or {}

    try:
        params = GraphParams(
            n_vertices=int(data.get("n_vertices", 20)),
            n_generators=int(data.get("n_generators", 5)),
            n_consumers=int(data.get("n_consumers", 10)),
            n_transit=int(data.get("n_transit", 5)),
            total_production=int(data.get("total_production", 50)),
            total_consumption=int(data.get("total_consumption", 35)),
            min_degree=int(data.get("min_degree", 2)),
            max_degree=int(data.get("max_degree", 5)),
            seed=int(data.get("seed", 42)),
        )
        result = generate_graph(params)
        return jsonify({"ok": True, **result})
    except (ValueError, TypeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Ошибка генерации: {exc}"}), 500


@app.post("/api/rebalance")
def api_rebalance():
    data = request.get_json(silent=True) or {}
    try:
        if "state" not in data:
            return jsonify({"ok": False, "error": "Нет state — нажмите «Сгенерировать» заново"}), 400
        state = GraphState.from_json(data["state"])
        disabled = {int(x) for x in data.get("disabled", [])}
        positions = data.get("positions")
        result = rebalance_graph(state, disabled, positions)
        return jsonify({"ok": True, **result})
    except (ValueError, TypeError, KeyError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Ошибка перебалансировки: {exc}"}), 500


@app.post("/api/weakest")
def api_weakest():
    data = request.get_json(silent=True) or {}
    try:
        if "state" not in data:
            return jsonify({"ok": False, "error": "Нет state — нажмите «Сгенерировать» заново"}), 400
        state = GraphState.from_json(data["state"])
        positions = data.get("positions")
        result = show_weakest_case(state, positions)
        return jsonify({"ok": True, **result})
    except (ValueError, TypeError, KeyError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Ошибка поиска слабой вершины: {exc}"}), 500


def open_browser():
    webbrowser.open("http://127.0.0.1:5000")


if __name__ == "__main__":
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        Timer(1.0, open_browser).start()
    app.run(debug=True, use_reloader=False, port=5000)
