/**
 * Pure Session-log → self-contained interactive HTML converter. Events come
 * from sessionQuery.readSession() (or a replayed session log); the output is
 * one HTML file with a filterable, searchable item sidebar and a detail pane,
 * in the spirit of pi-agent's /export. All dynamic text is escaped, and the
 * file carries no external references.
 */
import { renderMarkdown } from './markdown.js'

const UNTITLED = 'Untitled Session'

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function firstLine(text, max = 140) {
  const line = String(text).split('\n').find(part => part.trim() !== '') ?? ''
  const flat = line.trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function visibleText(content) {
  const parts = []
  for (const block of content ?? []) {
    switch (block.type) {
      case 'text':
        if (block.text !== '') parts.push(block.text)
        break
      case 'image': {
        const ref = block.attachment ?? {}
        parts.push(`[Image: ${ref.name ?? 'attachment'} (${ref.width ?? '?'}×${ref.height ?? '?'}, ${ref.bytes ?? '?'} bytes)]`)
        break
      }
      case 'file': {
        const ref = block.attachment ?? {}
        parts.push(`[File: ${ref.name ?? 'attachment'} (${ref.bytes ?? '?'} bytes)]`)
        break
      }
      default:
        break
    }
  }
  return parts.join('\n\n')
}

function jsonBlock(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function usageLine(usage) {
  if (usage === undefined || usage === null) return ''
  const parts = []
  if (usage.inputTokens !== undefined) parts.push(`in ${usage.inputTokens}`)
  if (usage.outputTokens !== undefined) parts.push(`out ${usage.outputTokens}`)
  if (usage.cacheReadTokens) parts.push(`cache-read ${usage.cacheReadTokens}`)
  if (usage.cacheWriteTokens) parts.push(`cache-write ${usage.cacheWriteTokens}`)
  if (usage.reasoningTokens) parts.push(`reasoning ${usage.reasoningTokens}`)
  return parts.join(' · ')
}

/**
 * Fold one committed event log into display items.
 * @param {readonly {type: string, surfaceOp?: string, seq?: number, data: object}[]} events
 * @returns {{items: object[], title: string}}
 */
function collectItems(events) {
  const items = []
  const calls = new Map()
  let title
  let turn = 0
  for (const event of events) {
    const data = event.data ?? {}
    switch (event.type) {
      case 'session/title':
        title = data.title
        break
      case 'turn/start':
        turn = data.turn ?? turn + 1
        items.push({ kind: 'meta', label: `turn ${turn}`, text: '', turn })
        break
      case 'user/message': {
        if (event.surfaceOp !== 'append') break
        const source = data.source ?? { kind: 'user' }
        const text = visibleText(data.content)
        if (text === '') break
        if (source.kind === 'user') {
          items.push({ kind: 'user', text, turn })
        } else {
          const label = source.summary ?? source.kind ?? 'context'
          items.push({ kind: 'custom', label, text, turn })
        }
        break
      }
      case 'assistant/message': {
        if (event.surfaceOp !== 'append') break
        const message = data.message ?? {}
        const chunks = (message.content ?? []).map((block) => {
          if (block.type === 'reasoning') return { reasoning: block.text }
          return { text: block.type === 'text' ? block.text : block.type === 'tool-call' ? '' : visibleText([block]) }
        })
        const text = chunks.map(chunk => chunk.text ?? '').filter(part => part !== '').join('\n\n')
        const reasoning = chunks.map(chunk => chunk.reasoning ?? '').filter(part => part !== '').join('\n\n')
        if (text.trim() === '' && reasoning.trim() === '') break
        items.push({
          kind: 'assistant', text, reasoning, turn,
          interrupted: data.interrupted === true,
          usage: usageLine(data.usage),
        })
        break
      }
      case 'tool/call': {
        const entry = {
          kind: 'tool', name: data.name ?? 'tool', arguments: data.arguments ?? '',
          result: undefined, turn,
        }
        items.push(entry)
        calls.set(String(data.callId), entry)
        break
      }
      case 'tool/result': {
        if (event.surfaceOp !== 'append') break
        const message = data.message ?? {}
        const callId = String(message.toolCallId ?? '')
        let entry = calls.get(callId)
        if (entry === undefined) {
          entry = { kind: 'tool', name: 'unknown', arguments: '', result: undefined, turn }
          items.push(entry)
          calls.set(callId, entry)
        }
        entry.result = {
          text: visibleText(message.content),
          isError: message.isError === true,
          reason: data.error?.reason,
        }
        break
      }
      case 'system/message': {
        if (event.surfaceOp !== 'append') break
        const text = visibleText(data.message?.content)
        if (text.trim() !== '') items.push({ kind: 'system', label: 'system', text, turn })
        break
      }
      case 'command/run': {
        items.push({ kind: 'meta', label: `/${data.name ?? 'command'}${data.args ? ` ${data.args}` : ''}`, text: '', turn })
        break
      }
      default:
        break
    }
  }
  return { items, title: typeof title === 'string' && title.trim() !== '' ? title.trim() : UNTITLED }
}

const KIND_LABEL = {
  user: 'user', assistant: 'assistant', tool: 'tool',
  system: 'system', custom: 'context', meta: 'meta',
}

function itemPreview(item) {
  switch (item.kind) {
    case 'user': return firstLine(item.text)
    case 'assistant': {
      const text = firstLine(item.text)
      if (text !== '') return text
      const thinking = firstLine(item.reasoning ?? '')
      return thinking === '' ? '(no visible content)' : `(thinking) ${thinking}`
    }
    case 'tool': return `${item.name}${item.result === undefined ? ' (pending)' : item.result.isError ? ' ✗' : ''}`
    case 'custom': return `[${item.label}] ${firstLine(item.text)}`
    case 'system': return firstLine(item.text)
    case 'meta': return item.label
    default: return ''
  }
}

function itemDetailHtml(item) {
  switch (item.kind) {
    case 'user':
      return `<div class="detail-label">user</div><div class="md">${renderMarkdown(item.text)}</div>`
    case 'assistant': {
      const parts = ['<div class="detail-label">assistant</div>']
      if (item.reasoning.trim() !== '') {
        parts.push(`<details class="thinking"><summary>Thinking</summary><div class="thinking-body">${escapeHtml(item.reasoning).replace(/\n/g, '<br>')}</div></details>`)
      }
      if (item.text.trim() !== '') parts.push(`<div class="md">${renderMarkdown(item.text)}</div>`)
      const foot = []
      if (item.interrupted) foot.push('(interrupted)')
      if (item.usage) foot.push(escapeHtml(item.usage))
      if (foot.length > 0) parts.push(`<div class="detail-foot">${foot.join(' · ')}</div>`)
      return parts.join('')
    }
    case 'tool': {
      const status = item.result === undefined ? 'pending' : item.result.isError ? 'error' : 'ok'
      const parts = [`<div class="detail-label">tool · ${escapeHtml(item.name)} · ${status}</div>`]
      parts.push('<div class="detail-sub">arguments</div>')
      parts.push(`<pre class="code">${escapeHtml(item.arguments === '' ? '(none)' : jsonBlock(item.arguments))}</pre>`)
      parts.push(`<div class="detail-sub">result</div>`)
      if (item.result === undefined) {
        parts.push('<pre class="code muted">(no result recorded)</pre>')
      } else {
        if (item.result.reason) parts.push(`<div class="error-reason">${escapeHtml(item.result.reason)}</div>`)
        parts.push(`<pre class="code${item.result.isError ? ' err' : ''}">${escapeHtml(item.result.text === '' ? '(no output)' : item.result.text)}</pre>`)
      }
      return parts.join('')
    }
    case 'custom':
      return `<div class="detail-label">context · ${escapeHtml(item.label)}</div><pre class="code">${escapeHtml(item.text)}</pre>`
    case 'system':
      return `<div class="detail-label">system</div><pre class="code">${escapeHtml(item.text)}</pre>`
    case 'meta':
      return `<div class="detail-label">${escapeHtml(item.label)}</div>`
    default:
      return ''
  }
}

function itemSearchText(item) {
  return [item.label, item.name, item.text, item.reasoning, item.arguments, item.result?.text, item.result?.reason]
    .filter(part => typeof part === 'string' && part !== '').join('\n').toLowerCase()
}

const FILTER_KINDS = {
  'default': ['user', 'assistant', 'tool'],
  'no-tools': ['user', 'assistant'],
  'user-only': ['user'],
  'labeled-only': ['custom', 'meta', 'system'],
  'all': ['user', 'assistant', 'tool', 'custom', 'system', 'meta'],
}

/** Filters that drop assistant steps carrying only reasoning, no visible text. */
const FILTER_SKIPS_THINKING = { 'no-tools': true }

const CSS = `
:root {
  --bg: #21252c; --panel: #282c34; --border: #3a3f47; --text: #dee0e1;
  --muted: #9da5a9; --dim: #7e888e; --accent: #a798d7; --link: #69add0;
  --code: #68b78d; --error: #ea7f81; --warn: #cd9a22; --ok: #68b78d;
  --sel: #213b49; --userbg: #213b49; --custombg: #3a3055; --toolok: #254131; --toolerr: #5b282a;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font: 12px/1.5 ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace; color: var(--text); background: var(--bg); }
#app { display: flex; height: 100vh; }
#sidebar { width: 400px; min-width: 220px; max-width: 60vw; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--panel); }
#sidebar .tools { padding: 8px; border-bottom: 1px solid var(--border); }
#search { width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; outline: none; }
#search:focus { border-color: var(--accent); }
#filters { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
#filters button { padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); font: inherit; cursor: pointer; }
#filters button.active { background: var(--custombg); color: var(--text); border-color: var(--accent); }
#count { color: var(--dim); padding: 6px 10px 0; }
#items { overflow-y: auto; flex: 1; padding: 6px 0; }
.item { display: block; width: 100%; text-align: left; padding: 3px 10px; border: 0; background: none; color: var(--muted); font: inherit; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item:hover { background: rgba(255,255,255,.04); }
.item.sel { background: var(--sel); color: var(--text); }
.item .b { display: inline-block; width: 10px; }
.item .k { font-weight: 600; }
.kind-user .k, .kind-user .b { color: var(--link); }
.kind-assistant .k, .kind-assistant .b { color: var(--ok); }
.kind-tool .k, .kind-tool .b { color: var(--accent); }
.kind-custom .k, .kind-custom .b { color: var(--accent); }
.kind-system .k, .kind-system .b { color: var(--dim); }
.kind-meta .k, .kind-meta .b { color: var(--dim); }
.item .err { color: var(--error); }
.item.turn { margin-top: 6px; padding-top: 4px; border-top: 1px dashed var(--border); }
#resizer { width: 5px; cursor: col-resize; background: transparent; }
#resizer:hover { background: var(--border); }
#main { flex: 1; overflow-y: auto; padding: 18px 26px 60px; min-width: 0; }
#detail { max-width: 980px; }
#detail .placeholder { color: var(--dim); padding: 40px 0; text-align: center; }
.detail-label { color: var(--dim); text-transform: uppercase; letter-spacing: .06em; font-size: 11px; margin-bottom: 8px; }
.detail-sub { color: var(--dim); margin: 14px 0 4px; }
.detail-foot { color: var(--dim); margin-top: 10px; }
.error-reason { color: var(--error); margin-bottom: 4px; }
pre.code { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; color: var(--code); }
pre.code.err { color: var(--error); background: var(--toolerr); border-color: var(--error); }
pre.code.muted { color: var(--dim); }
.thinking { border-left: 3px solid var(--border); padding-left: 10px; margin-bottom: 12px; color: var(--muted); }
.thinking summary { cursor: pointer; color: var(--dim); }
.thinking-body { white-space: pre-wrap; word-break: break-word; padding: 6px 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { color: var(--warn); margin: 16px 0 8px; }
.md h1 { font-size: 17px; } .md h2 { font-size: 15px; } .md h3 { font-size: 13px; }
.md p { margin: 8px 0; }
.md a { color: var(--link); }
.md code { background: var(--panel); border-radius: 4px; padding: 1px 5px; color: var(--accent); }
.md pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin: 10px 0; overflow-x: auto; }
.md pre code { background: none; padding: 0; color: var(--code); }
.md pre[data-lang]::before { content: attr(data-lang); float: right; color: var(--dim); }
.md blockquote { border-left: 3px solid var(--border); padding-left: 12px; color: var(--muted); margin: 8px 0; }
.md ul, .md ol { margin: 8px 0 8px 22px; }
.md hr { border: 0; border-top: 1px solid var(--border); margin: 14px 0; }
.md table { border-collapse: collapse; margin: 10px 0; }
.md th, .md td { border: 1px solid var(--border); padding: 4px 10px; }
.md th { background: var(--panel); }
mark { background: var(--warn); color: var(--bg); border-radius: 2px; padding: 0 1px; }
.item mark { background: var(--warn); }
@media (max-width: 760px) {
  #app { flex-direction: column; }
  #sidebar { width: 100%; max-width: none; max-height: 45vh; border-right: 0; border-bottom: 1px solid var(--border); }
  #resizer { display: none; }
}
`

const APP_JS = `
const FILTERS = ${JSON.stringify(FILTER_KINDS)};
const SKIP_THINKING = ${JSON.stringify(FILTER_SKIPS_THINKING)};
const list = document.getElementById('items');
const detail = document.getElementById('detail');
const search = document.getElementById('search');
const count = document.getElementById('count');
let filter = 'default';
let query = '';
let visible = [];
let sel = -1;

function passes(i) {
  if (!FILTERS[filter].includes(ITEMS[i].kind)) return false;
  if (SKIP_THINKING[filter] === true && ITEMS[i].thinking === true) return false;
  if (query === '') return true;
  const hay = ITEMS[i].search;
  return query.toLowerCase().split(/\\s+/).filter(Boolean).every(tok => hay.includes(tok));
}
function row(i) {
  const it = ITEMS[i];
  const b = document.createElement('button');
  b.className = 'item kind-' + it.kind + (i === sel ? ' sel' : '') + (it.turnStart ? ' turn' : '');
  const status = it.kind === 'tool' && it.status === 'error' ? ' <span class="err">✗</span>' : '';
  b.innerHTML = '<span class="b">•</span><span class="k">' + it.tag + ':</span> ' + it.preview + status;
  b.title = it.preview;
  b.addEventListener('click', () => select(i));
  return b;
}
function render() {
  visible = [];
  for (let i = 0; i < ITEMS.length; i++) if (passes(i)) visible.push(i);
  count.textContent = visible.length + ' / ' + ITEMS.length + ' entries';
  list.textContent = '';
  for (const i of visible) list.appendChild(row(i));
  if (!visible.includes(sel)) sel = visible[0] ?? -1;
  if (sel >= 0) select(sel);
  else { detail.innerHTML = '<div class="placeholder">No entries match.</div>'; }
}
function unmark(node) {
  node.querySelectorAll('mark').forEach(m => { m.replaceWith(document.createTextNode(m.textContent)); });
  node.normalize();
}
function highlight(node, q) {
  const toks = q.toLowerCase().split(/\\s+/).filter(Boolean);
  if (toks.length === 0) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const jobs = [];
  while (walker.nextNode()) jobs.push(walker.currentNode);
  for (const text of jobs) {
    const low = text.nodeValue.toLowerCase();
    let idx = -1, len = 0;
    for (const tok of toks) { const at = low.indexOf(tok); if (at >= 0 && (idx < 0 || at < idx)) { idx = at; len = tok.length; } }
    if (idx < 0) continue;
    const mark = document.createElement('mark');
    mark.textContent = text.nodeValue.slice(idx, idx + len);
    const after = text.splitText(idx);
    after.splitText(len);
    text.parentNode.insertBefore(mark, after);
  }
}
function select(i) {
  sel = i;
  list.querySelectorAll('.item.sel').forEach(el => el.classList.remove('sel'));
  const rows = [...list.children];
  const pos = visible.indexOf(i);
  if (pos >= 0 && rows[pos]) { rows[pos].classList.add('sel'); rows[pos].scrollIntoView({ block: 'nearest' }); }
  detail.innerHTML = ITEMS[i].html;
  highlight(detail, query);
  detail.scrollTop = 0; document.getElementById('main').scrollTop = 0;
}
search.addEventListener('input', () => { query = search.value; render(); });
document.getElementById('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('active', x === b));
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.target === search) return;
  const pos = visible.indexOf(sel);
  if (e.key === 'ArrowDown' || e.key === 'j') { if (pos + 1 < visible.length) select(visible[pos + 1]); e.preventDefault(); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { if (pos > 0) select(visible[pos - 1]); e.preventDefault(); }
  else if (e.key === '/') { search.focus(); e.preventDefault(); }
});
const resizer = document.getElementById('resizer');
resizer.addEventListener('mousedown', () => {
  const move = (e) => {
    const w = Math.min(Math.max(e.clientX, 220), window.innerWidth * 0.6);
    document.getElementById('sidebar').style.width = w + 'px';
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.userSelect = ''; };
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
});
render();
`

/**
 * Render a complete committed Session log as one self-contained HTML page.
 * @param {readonly object[]} events - committed logical events in seq order, including any inherited prefix.
 * @param {{title?: string, generated?: string|Date}} [options] - optional title override and generation stamp.
 * @returns {string} complete HTML document.
 */
export function formatSessionHtml(events, options = {}) {
  const { items, title } = collectItems(events)
  const finalTitle = options.title ?? title
  let lastTurn = -1
  const payload = items.map((item) => {
    const turnStart = item.turn !== undefined && item.kind !== 'meta' && item.turn !== lastTurn
    if (item.turn !== undefined) lastTurn = item.turn
    return {
      kind: item.kind,
      tag: escapeHtml(item.kind === 'tool' ? item.name : KIND_LABEL[item.kind] ?? item.kind),
      status: item.kind === 'tool'
        ? (item.result === undefined ? 'pending' : item.result.isError ? 'error' : 'ok')
        : undefined,
      thinking: item.kind === 'assistant' && item.text.trim() === '',
      preview: escapeHtml(itemPreview(item)),
      html: itemDetailHtml(item),
      search: itemSearchText(item),
      turnStart,
    }
  })
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  const stamp = options.generated === undefined ? '' : `<div id="stamp">${escapeHtml(String(options.generated))}</div>`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(finalTitle)} — Session Export</title>
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <div id="sidebar">
    <div class="tools">
      <input id="search" type="search" placeholder="Search…" autocomplete="off">
      <div id="filters">
        <button data-filter="default" class="active" title="User, assistant, and tool entries">Default</button>
        <button data-filter="no-tools" title="Default minus tool entries and thinking-only steps">No-tools</button>
        <button data-filter="user-only" title="Only user messages">User</button>
        <button data-filter="labeled-only" title="Only labeled entries">Labeled</button>
        <button data-filter="all" title="Show everything">All</button>
      </div>
      <div id="count"></div>
    </div>
    <div id="items"></div>
  </div>
  <div id="resizer"></div>
  <div id="main"><div id="detail"><div class="placeholder">Loading…</div></div>${stamp}</div>
</div>
<script>
const ITEMS = ${json};
${APP_JS}
</script>
</body>
</html>
`
}
