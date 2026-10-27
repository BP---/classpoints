"""ClassPoints - a small web server for giving students points.

Uses only the Python standard library: http.server for HTTP and sqlite3 for storage.
Run with:  python server.py  [--host 127.0.0.1] [--port 8000]
The database file defaults to local.db and can be changed with DATABASE_URL.
"""

import argparse
import json
import mimetypes
import os
import re
import sqlite3
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = os.environ.get("DATABASE_URL", str(BASE_DIR / "local.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    class_id INTEGER NOT NULL REFERENCES classes(id)
);
CREATE TABLE IF NOT EXISTS points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    points INTEGER NOT NULL,
    content TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_points_student ON points(student_id);
"""


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(SCHEMA)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def parse_int(value, what):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Invalid {what}")


# ---------------------------------------------------------------------------
# API handlers. Each receives (conn, match, query, body) and returns a JSON-able value.
# ---------------------------------------------------------------------------

def list_classes(conn, match, query, body):
    rows = conn.execute(
        """SELECT c.id, c.name, COUNT(s.id) AS student_count
           FROM classes c LEFT JOIN students s ON s.class_id = c.id
           GROUP BY c.id ORDER BY c.name COLLATE NOCASE"""
    ).fetchall()
    return [dict(r) for r in rows]


def create_class(conn, match, query, body):
    name = (body.get("name") or "").strip()
    if not name:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Class name is required")

    raw = body.get("students")
    if not isinstance(raw, list):
        raise ApiError(HTTPStatus.BAD_REQUEST, "At least one student is required")

    # Trim, drop empties and remove duplicates while keeping order
    names = []
    for s in raw:
        if isinstance(s, str) and s.strip() and s.strip() not in names:
            names.append(s.strip())
    if not names:
        raise ApiError(HTTPStatus.BAD_REQUEST, "At least one valid student name is required")

    cur = conn.execute("INSERT INTO classes (name) VALUES (?)", (name,))
    class_id = cur.lastrowid
    conn.executemany(
        "INSERT INTO students (name, class_id) VALUES (?, ?)",
        [(n, class_id) for n in names],
    )
    return {"id": class_id}


def get_class_row(conn, class_id):
    row = conn.execute("SELECT id, name FROM classes WHERE id = ?", (class_id,)).fetchone()
    if row is None:
        raise ApiError(HTTPStatus.NOT_FOUND, "Class not found")
    return dict(row)


def get_class(conn, match, query, body):
    class_id = parse_int(match["id"], "class ID")
    cls = get_class_row(conn, class_id)
    students = conn.execute(
        "SELECT id, name FROM students WHERE class_id = ? ORDER BY id", (class_id,)
    ).fetchall()
    return {"class": cls, "students": [dict(s) for s in students]}


def class_overview(conn, match, query, body):
    class_id = parse_int(match["id"], "class ID")
    cls = get_class_row(conn, class_id)
    rows = conn.execute(
        """SELECT s.id, s.name, COALESCE(SUM(p.points), 0) AS total
           FROM students s LEFT JOIN points p ON p.student_id = s.id
           WHERE s.class_id = ?
           GROUP BY s.id ORDER BY s.name COLLATE NOCASE""",
        (class_id,),
    ).fetchall()
    return {"class": cls, "students": [dict(r) for r in rows]}


def get_student(conn, match, query, body):
    student_id = parse_int(match["id"], "student ID")
    row = conn.execute(
        """SELECT s.id, s.name, c.id AS class_id, c.name AS class_name
           FROM students s JOIN classes c ON c.id = s.class_id
           WHERE s.id = ?""",
        (student_id,),
    ).fetchone()
    if row is None:
        raise ApiError(HTTPStatus.NOT_FOUND, "Student not found")
    points = conn.execute(
        """SELECT id, points, content, created_at FROM points
           WHERE student_id = ? ORDER BY created_at DESC, id DESC""",
        (student_id,),
    ).fetchall()
    return {
        "student": {"id": row["id"], "name": row["name"]},
        "class": {"id": row["class_id"], "name": row["class_name"]},
        "points": [dict(p) for p in points],
    }


def add_points(conn, match, query, body):
    student_id = parse_int(body.get("studentId"), "student ID")
    value = parse_int(body.get("pointsValue"), "points value")
    if value == 0:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Points must not be zero")
    if conn.execute("SELECT 1 FROM students WHERE id = ?", (student_id,)).fetchone() is None:
        raise ApiError(HTTPStatus.NOT_FOUND, "Student not found")
    content = (body.get("content") or "").strip() or None
    cur = conn.execute(
        "INSERT INTO points (student_id, points, content, created_at) VALUES (?, ?, ?, ?)",
        (student_id, value, content, int(time.time())),
    )
    row = conn.execute(
        "SELECT id, student_id, points, content, created_at FROM points WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return {"success": True, "point": dict(row)}


def delete_point(conn, match, query, body):
    point_id = parse_int(match["id"], "point ID")
    cur = conn.execute("DELETE FROM points WHERE id = ?", (point_id,))
    if cur.rowcount == 0:
        raise ApiError(HTTPStatus.NOT_FOUND, "Point not found")
    return {"success": True}


ROUTES = [
    ("GET", r"/api/classes", list_classes),
    ("POST", r"/api/classes", create_class),
    ("GET", r"/api/classes/(?P<id>\d+)", get_class),
    ("GET", r"/api/classes/(?P<id>\d+)/overview", class_overview),
    ("GET", r"/api/students/(?P<id>\d+)", get_student),
    ("POST", r"/api/points", add_points),
    ("DELETE", r"/api/points/(?P<id>\d+)", delete_point),
]
ROUTES = [(m, re.compile(p + r"/?$"), h) for m, p, h in ROUTES]


class Handler(BaseHTTPRequestHandler):
    server_version = "ClassPoints/1.0"

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            self.handle_api(method, url)
        elif method == "GET":
            self.serve_static(url.path)
        else:
            self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Method not allowed"})

    def handle_api(self, method, url):
        path_matched = False
        for route_method, pattern, handler in ROUTES:
            match = pattern.match(url.path)
            if not match:
                continue
            path_matched = True
            if route_method != method:
                continue
            try:
                body = self.read_json() if method in ("POST", "DELETE") else {}
                conn = connect()
                try:
                    with conn:  # commits on success, rolls back on error
                        result = handler(conn, match.groupdict(), parse_qs(url.query), body)
                finally:
                    conn.close()
                status = HTTPStatus.CREATED if method == "POST" else HTTPStatus.OK
                self.send_json(status, result)
            except ApiError as e:
                self.send_json(e.status, {"error": e.message})
            except Exception as e:  # noqa: BLE001 - report unexpected errors as JSON
                self.log_error("Unhandled error: %r", e)
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Internal server error"})
            return
        if path_matched:
            self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Method not allowed"})
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
        if not isinstance(data, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "JSON body must be an object")
        return data

    def send_json(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def serve_static(self, path):
        # Files in /static are served directly; any other path gets index.html
        # so the frontend router can handle URLs like /class/3 or /student/7.
        file = None
        if path.startswith("/static/"):
            candidate = (STATIC_DIR / path[len("/static/"):]).resolve()
            if candidate.is_file() and STATIC_DIR in candidate.parents:
                file = candidate
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
        else:
            file = STATIC_DIR / "index.html"

        content = file.read_bytes()
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    parser = argparse.ArgumentParser(description="ClassPoints web server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", help="SQLite database file (overrides DATABASE_URL)")
    args = parser.parse_args()

    global DB_PATH
    if args.db:
        DB_PATH = args.db

    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")

    init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ClassPoints running at http://{args.host}:{args.port}  (database: {DB_PATH})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
