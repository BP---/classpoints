# ClassPoints

A small app for giving students points for positive things they do.

The server is plain Python (standard library only: `http.server` + `sqlite3`), and the
frontend is vanilla HTML/CSS/JS with no build step and no dependencies.

## Running

Requires Python 3.9+.

### Windows: double-click to start

Double-click `start-classpoints.bat`. It starts the server on port 8007 and opens
http://127.0.0.1:8007 in your default browser as soon as the server is ready. Close the
black server window to stop the app. Starting it again while it is already running just
opens the page again.

For a desktop shortcut: right-click `start-classpoints.bat` → *Show more options* →
*Send to* → *Desktop (create shortcut)*. The .bat finds the project folder by itself, so
the shortcut keeps working wherever the project is, as long as it points to the .bat. If
you copy the .bat file itself somewhere else instead, edit the `PROJECT_DIR` line in it.

### From a terminal

```sh
python server.py --open
```

Options:

- `--open` to open the app in the browser once the server is ready
- `--port 8080` to use another port (default 8007)
- `--host 0.0.0.0` to make it reachable from other machines on the network
- `--db path/to/file.db` (or the `DATABASE_URL` environment variable) to choose the
  database file. Defaults to `local.db` next to `server.py`; it is created automatically.

The schema matches the earlier SvelteKit/Drizzle version, so an existing `local.db`
from that version can be used as is.

## Pages

| URL | What it does |
| --- | --- |
| `/` | Home |
| `/class` | List of classes |
| `/addClass` | Create a class, add students by hand or import a CSV (`Fornavn`, `Etternavn` columns, `;` or `,` separated) |
| `/class/<id>` | Students in a class, with a name filter |
| `/class/overview?classId=<id>` | Bar chart and sortable table of each student's total points |
| `/student/<id>` | Give or take points with an optional comment, view and delete point history. Shortcuts: `+`/`-` adjust, `Enter` saves |

## API

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/api/classes` | `[{id, name, student_count}]` |
| POST | `/api/classes` | `{name, students: [names]}` → `{id}` |
| GET | `/api/classes/<id>` | `{class, students}` |
| GET | `/api/classes/<id>/overview` | `{class, students: [{id, name, total}]}` |
| GET | `/api/students/<id>` | `{student, class, points}` |
| POST | `/api/points` | `{studentId, pointsValue, content?}` → `{success, point}` |
| DELETE | `/api/points/<id>` | `{success}` |

## Files

- `server.py` – HTTP server, routing, API and database setup
- `static/index.html` – page shell
- `static/app.js` – client-side router and all views
- `static/app.css` – styles (light and dark themes follow the OS setting)
