/**
 * Dependency-free Markdown subset renderer for the session export HTML.
 * Every input character is HTML-escaped before inline parsing, so the output
 * can be injected with innerHTML without a sanitizer; raw HTML in the source
 * renders as literal text. Supported blocks: ATX headings, fenced code,
 * blockquotes, unordered/ordered/task lists, pipe tables, thematic breaks,
 * and paragraphs. Inline: `code`, **bold**, *italic*, ~~strike~~, [links](url),
 * and bare autolinks.
 */

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fenceOf(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (match === null) return undefined
  if (match[1].startsWith('`') && match[2].includes('`')) return undefined
  return { marker: match[1][0], length: match[1].length, lang: match[2].trim() }
}

function closesFence(line, fence) {
  return new RegExp(`^ {0,3}${fence.marker}{${fence.length},}\\s*$`).test(line)
}

function headingOf(line) {
  const match = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
  return match === null ? undefined : { depth: match[1].length, text: match[2] }
}

function listItemOf(line) {
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
  if (match === null) return undefined
  const task = /^\[( |x|X)\]\s+/.exec(match[3])
  return {
    indent: match[1].replace(/\t/g, '    ').length,
    ordered: /^\d/.test(match[2]),
    text: task === null ? match[3] : match[3].slice(task[0].length),
    checked: task === null ? undefined : task[1].toLowerCase() === 'x',
  }
}

function isTableDivider(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let cell = ''
  let escaped = false
  for (const ch of trimmed) {
    if (escaped) { cell += ch; escaped = false }
    else if (ch === '\\') escaped = true
    else if (ch === '|') { cells.push(cell.trim()); cell = '' }
    else cell += ch
  }
  cells.push(cell.trim())
  return cells
}

function inline(text) {
  let out = escapeHtml(text)
  // Inline code first so its contents stay literal.
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => `\x01${code}\x02`)
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, label, href) => {
    const safe = /^https?:\/\/|^mailto:|^#|^\//i.test(href) ? href : '#'
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label === '' ? href : label}</a>`
  })
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, url) =>
    `${pre}<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  out = out.replace(/\x01(.*?)\x02/g, (_m, code) => `<code>${code}</code>`)
  return out
}

function renderList(items, ordered) {
  const tag = ordered ? 'ol' : 'ul'
  const rows = items.map((item) => {
    const box = item.checked === undefined
      ? ''
      : `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `
    return `<li>${box}${inline(item.text)}</li>`
  })
  return `<${tag}>${rows.join('')}</${tag}>`
}

function renderTable(header, divider, rows) {
  const aligns = splitTableRow(divider).map(cell =>
    /^:-+:$/.test(cell) ? 'center' : /^-+:$/.test(cell) ? 'right' : '')
  const th = splitTableRow(header).map((cell, i) =>
    `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${inline(cell)}</th>`).join('')
  const trs = rows.map(row =>
    `<tr>${splitTableRow(row).map((cell, i) =>
      `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ''}>${inline(cell)}</td>`).join('')}</tr>`)
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs.join('')}</tbody></table>`
}

/**
 * Render one Markdown fragment to an HTML string.
 * @param {string} source - untrusted Markdown text.
 * @returns {string} escaped, sanitized-by-construction HTML.
 */
export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = fenceOf(line)
    if (fence !== undefined) {
      const body = []
      i += 1
      while (i < lines.length && !closesFence(lines[i], fence)) { body.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      const lang = fence.lang === '' ? '' : ` data-lang="${escapeHtml(fence.lang)}"`
      out.push(`<pre${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const heading = headingOf(line)
    if (heading !== undefined) {
      out.push(`<h${heading.depth}>${inline(heading.text)}</h${heading.depth}>`)
      i += 1
      continue
    }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>')
      i += 1
      continue
    }
    if (/^ {0,3}>/.test(line)) {
      const body = []
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ''))
        i += 1
      }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]) && line.trim() !== '') {
      const header = line
      const divider = lines[i + 1]
      const rows = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(lines[i])
        i += 1
      }
      out.push(renderTable(header, divider, rows))
      continue
    }
    const item = listItemOf(line)
    if (item !== undefined && line.trim() !== '') {
      const items = []
      const ordered = item.ordered
      while (i < lines.length) {
        const next = listItemOf(lines[i])
        if (next == null || next.ordered !== ordered || next.indent !== item.indent) break
        items.push(next)
        i += 1
      }
      out.push(renderList(items, ordered))
      continue
    }
    if (line.trim() === '') { i += 1; continue }
    const paragraph = [line]
    i += 1
    while (i < lines.length) {
      const follow = lines[i]
      if (follow.trim() === '' || fenceOf(follow) !== undefined || headingOf(follow) !== undefined
        || /^ {0,3}>/.test(follow) || listItemOf(follow) !== undefined
        || /^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(follow)) break
      if (follow.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) break
      paragraph.push(follow)
      i += 1
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`)
  }
  return out.join('\n')
}
