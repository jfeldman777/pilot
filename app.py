"""Локальный сервер: раздаёт статическую версию из docs/."""

import os
import webbrowser
from threading import Timer

from flask import Flask, send_from_directory

DOCS = os.path.join(os.path.dirname(__file__), "docs")

app = Flask(__name__, static_folder=DOCS, static_url_path="")


@app.get("/")
def index():
    return send_from_directory(DOCS, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(DOCS, path)


def open_browser():
    webbrowser.open("http://127.0.0.1:5000")


if __name__ == "__main__":
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        Timer(1.0, open_browser).start()
    app.run(debug=True, use_reloader=False, port=5000)
