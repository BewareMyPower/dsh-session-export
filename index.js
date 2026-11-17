/**
 * Host half of @bewaremypower/dsh-session-export: the /export-html command and
 * the authenticated route that renders a Session log as one self-contained
 * interactive HTML page. The browser half (./client) opens that page in the
 * right Sidebar and offers a session-header menu row and file download.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { formatSessionHtml } from './html.js'

export const name = 'session-export'
export const inject = ['commands']

/** Absolute registration path for the HTML export route. */
export const SESSION_EXPORT_PATH = '/api/session-export.html'
/** Browser-relative form of {@link SESSION_EXPORT_PATH}. */
export const SESSION_EXPORT_ROUTE = SESSION_EXPORT_PATH.slice(1)

const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/
const DEFAULT_COMMAND = 'export-html'

/**
 * @param {string|undefined} value - configured command name.
 * @returns {string} a syntactically valid lowercase command name.
 */
function commandName(value) {
  const name = value ?? DEFAULT_COMMAND
  if (!COMMAND_NAME.test(name)) {
    throw new Error(`session-export: invalid command name "${String(value)}" — must match ${COMMAND_NAME}`)
  }
  return name
}

/**
 * Resolve a user-supplied output path: absolute or ~/… only, so the write
 * never depends on the host process's working directory.
 * @param {string} arg - raw command argument.
 * @returns {string|undefined} the resolved absolute path, or undefined when the form is unsupported.
 */
function outputPath(arg) {
  const expanded = arg === '~' || arg.startsWith('~/')
    ? resolve(homedir(), arg.slice(2))
    : arg
  return isAbsolute(expanded) ? expanded : undefined
}

function safeFileStem(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')
}

function isSessionNotFound(error) {
  return error instanceof Error
    && 'code' in error
    && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND'
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {{command?: string}} [config] - optional command name override.
 */
export function apply(ctx, config = {}) {
  const command = commandName(config.command)
  ctx.effect(() => ctx.commands.register({
    definitionId: '@bewaremypower/dsh-session-export',
    name: command,
    description: 'Open or save this Session as an interactive HTML page',
    input: { hint: '[output.html]' },
    handler: async (invocation) => {
      const arg = invocation.rawInput.trim()
      if (arg === '') return { kind: 'success', text: 'Session HTML export opened.' }
      const path = outputPath(arg)
      if (path === undefined) {
        return { kind: 'error', text: `/${command} accepts an absolute or ~/… output path.` }
      }
      const sessionQuery = ctx.get('sessionQuery')
      if (sessionQuery === undefined) {
        return { kind: 'error', text: 'session HTML export is unavailable: missing session-query service' }
      }
      try {
        const snapshot = await sessionQuery.readSession(invocation.agent.id)
        const html = formatSessionHtml(snapshot.events, { generated: new Date().toISOString() })
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, html)
        return { kind: 'success', text: `Session exported to ${path}` }
      } catch (error) {
        if (isSessionNotFound(error)) return { kind: 'error', text: 'Session log not found.' }
        throw error
      }
    },
  }), 'session-export: command')

  const connection = ctx.get('connection')
  if (connection === undefined) return
  connection.fetch.register({
    path: SESSION_EXPORT_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId')
      if (sessionId === null || sessionId === '') {
        return new Response('missing sessionId query parameter', { status: 400 })
      }
      const sessionQuery = ctx.get('sessionQuery')
      if (sessionQuery === undefined) {
        return new Response('session HTML export is unavailable: missing session-query service', { status: 500 })
      }
      try {
        request.signal.throwIfAborted()
        const snapshot = await sessionQuery.readSession(sessionId)
        request.signal.throwIfAborted()
        const headers = { 'content-type': 'text/html; charset=utf-8' }
        if (url.searchParams.get('download') === '1') {
          headers['content-disposition'] = `attachment; filename="dsh-session-${safeFileStem(sessionId)}.html"`
        }
        if (request.method === 'HEAD') return new Response(null, { headers })
        return new Response(formatSessionHtml(snapshot.events, { generated: new Date().toISOString() }), { headers })
      } catch (error) {
        request.signal.throwIfAborted()
        if (isSessionNotFound(error)) return new Response('session not found', { status: 404 })
        return new Response('session HTML export failed to read the stored log', { status: 500 })
      }
    },
  })
}
