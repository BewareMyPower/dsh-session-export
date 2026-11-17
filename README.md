# @bewaremypower/dsh-session-export

DeepSeek Harness plugin that renders a Session as a **self-contained interactive HTML page** — in the spirit of pi-agent's `/export` — and opens it in the Web GUI's right Sidebar.

The exported page needs no server and no assets:

- a left sidebar lists every entry (`user`, `assistant`, `tool`, `context`, `system`, `meta`) with a live **search box** and filter tabs (**Default / No-tools / User / Labeled / All**),
- the right pane shows the selected entry: Markdown-rendered assistant text (reasoning folded into a collapsible *Thinking* block), tool arguments + result with error highlighting, injected context, and turn separators,
- `↑`/`↓` (or `j`/`k`) move the selection, `/` focuses search, and matches are highlighted in the detail pane.

## What it adds

| Surface | Behavior |
|---|---|
| `/export-html` | Renders the current session and opens the **Session export** Sidebar tab. |
| `/export-html <path>` | Writes the same HTML to an absolute or `~/…` file on the Host. |
| Sidebar tab | Session-scoped `Session export` tab; refresh refetches a fresh snapshot of the live log. |
| Header More menu | **View session as HTML** and **Download session HTML** (browser download of `dsh-session-<id>.html`). |

The Sidebar page frames the generated document in a `sandbox="allow-scripts allow-downloads"` iframe, so the export's own scripts cannot reach the application.

> The shipped `session-log-download` plugin already owns `/export` (ZIP + Markdown copy). This plugin registers `/export-html` so both can stay mounted; set `config.command` to rename it.

## Install

The package is a DSH bundle (`dsh.bundle.patch` → `cordis.patch.yml`), so it installs like any third-party bundle:

- Plugins page in the DSH Web sidebar, or
- the `plugin_manager` tool with the spec `github:bewaremypower/dsh-session-export`, or
- `pnpm add github:bewaremypower/dsh-session-export` inside `~/.dsh/profiles/<profile>/`.

For local development, install `link:<absolute path to this repo>`. Changes to `index.js` apply on restart/HMR; changes to `client.js` are picked up by the client-module revision check.

## Configuration

```yaml
- id: session-export
  config:
    command: export-html   # must match /^[a-z][a-z0-9_-]*$/
```

| Field | Default | Meaning |
|---|---|---|
| `command` | `export-html` | Slash command name to register. |

## How it works

- **Host** (`index.js`): registers the command and `GET /api/session-export.html?sessionId=<id>[&download=1]`. The route reads the committed log through `ctx.sessionQuery.readSession()` — so it works with any mounted persistence backend and includes the fork-inherited prefix — and pipes the events through `formatSessionHtml()`.
- **Renderer** (`html.js`, `markdown.js`): pure functions. Events fold into display items (`user/message`, `assistant/message`, `tool/call`+`tool/result`, `system/message`, `command/run`, other `user/message` sources as `context`), then serialize to one HTML string: inline CSS, an `ITEMS` JSON payload (every literal `<` written as the `\u003c` escape, so nothing can break out of the script tag), and a small vanilla-JS app for list/search/filter/select. Markdown is rendered at export time by a dependency-free subset parser that escapes every input character — no raw HTML passes through.
- **Browser** (`client.js`): a hand-authored client-module bundle (`dsh.client` in `package.json`, `window.__ModuleLoader__.load`). It registers the `session-export` tab type and its `sidebar.right.pane.tab` body (sandboxed iframe fed from the route via `srcDoc`), listens for `command/executed` to open the tab after `/export-html`, and adds the two Session Header menu rows.

## Test

```sh
node --test test.js
```
