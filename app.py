"""Локальный сервер: раздаёт статическую версию из корня проекта."""

import os
import webbrowser
from threading import Timer

from flask import Flask, send_from_directory

ROOT = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)


@app.get("/")
def home():
    return send_from_directory(ROOT, "home.html")


@app.get("/index.html")
def index_page():
    return send_from_directory(ROOT, "index.html")


@app.get("/small.html")
def small_page():
    return send_from_directory(ROOT, "index.html")


@app.get("/home.html")
def home_html():
    return send_from_directory(ROOT, "home.html")


@app.get("/graph_core.js")
def graph_core_js():
    return send_from_directory(ROOT, "graph_core.js")


@app.get("/map.html")
def map_html():
    return send_from_directory(ROOT, "map.html")


@app.get("/eng-small.html")
def eng_small_page():
    return send_from_directory(ROOT, "eng-small.html")


@app.get("/eng-map.html")
def eng_map_page():
    return send_from_directory(ROOT, "eng-map.html")


@app.get("/eng-large.html")
def eng_large_page():
    return send_from_directory(ROOT, "eng-large.html")


@app.get("/eng-large-map.html")
def eng_large_map_page():
    return send_from_directory(ROOT, "eng-large-map.html")


@app.get("/readme.html")
def readme_page():
    return send_from_directory(ROOT, "readme.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(ROOT, path)


def open_browser():
    webbrowser.open("http://127.0.0.1:5001")


if __name__ == "__main__":
    port = 5001
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        print(f"Откройте: http://127.0.0.1:{port}")
        Timer(1.0, open_browser).start()
    app.run(debug=True, use_reloader=False, port=port)
