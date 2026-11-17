import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatSessionHtml } from './html.js'
import { renderMarkdown } from './markdown.js'

const user = (text, source = { kind: 'user' }) => ({
  type: 'user/message', surfaceOp: 'append',
  data: { source, content: [{ type: 'text', text }] },
})
const assistant = (text, extra = {}) => ({
  type: 'assistant/message', surfaceOp: 'append',
  data: { message: { content: [{ type: 'text', text }] }, ...extra },
})
const call = (callId, name, args = '{}') => ({
  type: 'tool/call', data: { callId, name, arguments: args },
})
const result = (callId, text, isError = false) => ({
  type: 'tool/result', surfaceOp: 'append',
  data: { message: { toolCallId: callId, content: [{ type: 'text', text }], isError } },
})

test('escapes HTML in messages and produced markup', () => {
  const html = formatSessionHtml([
    user('<script>alert(1)</script>'),
    assistant('**bold** and `code`'),
  ])
  assert.ok(!html.includes('<script>alert'))
  assert.ok(html.includes('&lt;script&gt;'))
  // Detail markup embeds as JSON, so element tags appear as \u003c sequences.
  assert.ok(html.includes('\\u003cstrong>bold'))
  assert.ok(html.includes('\\u003ccode>code'))
})

test('pairs tool calls with their results and marks errors', () => {
  const html = formatSessionHtml([
    call('c1', 'exec', '{"cmd":"ls"}'),
    result('c1', 'boom', true),
  ])
  assert.ok(html.includes('exec'))
  assert.ok(html.includes('&quot;cmd&quot;: &quot;ls&quot;'))
  assert.ok(html.includes('boom'))
  assert.ok(html.includes('✗'))
})

test('renders reasoning, interruption, and usage on assistant entries', () => {
  const html = formatSessionHtml([
    {
      type: 'assistant/message', surfaceOp: 'append',
      data: {
        message: { content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'answer' }] },
        interrupted: true,
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    },
  ])
  assert.ok(html.includes('Thinking'))
  assert.ok(html.includes('hmm'))
  assert.ok(html.includes('interrupted'))
  assert.ok(html.includes('in 1'))
})

test('flags reasoning-only assistant steps so No-tools can drop them', () => {
  const html = formatSessionHtml([
    {
      type: 'assistant/message', surfaceOp: 'append',
      data: {
        message: {
          content: [
            { type: 'reasoning', text: 'hmm' },
            { type: 'tool-call', id: 'c1', name: 'exec', arguments: '{}' },
            { type: 'tool-call', id: 'c2', name: 'exec', arguments: '{}' },
          ],
        },
      },
    },
    assistant('answer'),
  ])
  const items = JSON.parse(html.match(/const ITEMS = (\[.*?\]);\n/s)[1])
  assert.deepEqual(items.map(item => item.thinking), [true, false])
  assert.equal(items[0].preview, '(thinking) hmm')
})

test('labels non-human user-role sources as context entries', () => {
  const html = formatSessionHtml([
    user('file changed', { kind: 'file-notice', summary: 'file-notice' }),
  ])
  assert.ok(html.includes('context'))
  assert.ok(html.includes('file changed'))
})

test('uses the latest session/title and falls back to Untitled', () => {
  const titled = formatSessionHtml([{ type: 'session/title', data: { title: 'Mine' } }])
  assert.ok(titled.includes('<title>Mine — Session Export</title>'))
  const blank = formatSessionHtml([])
  assert.ok(blank.includes('Untitled Session'))
})

test('markdown renders headings, lists, tables, and links', () => {
  const html = renderMarkdown('# H\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n[link](https://e.com) `x`')
  assert.ok(html.includes('<h1>H</h1>'))
  assert.ok(html.includes('<li>a</li>'))
  assert.ok(html.includes('<td>1</td>'))
  assert.ok(html.includes('href="https://e.com"'))
})

test('markdown blocks raw HTML and unsafe links', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1))')
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('javascript:alert'))
})
