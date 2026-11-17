/**
 * Browser half of @bewaremypower/dsh-session-export, authored directly in the
 * client-module bundle format: registration only at script evaluation, all
 * work inside the factory. Renders the Host's /api/session-export.html route
 * inside a sandboxed iframe as a right-Sidebar tab, opens that tab after a
 * successful /export-html command, and contributes Session Header menu rows.
 */
window.__ModuleLoader__.load({
  id: '@bewaremypower/dsh-session-export',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const PKG = '@bewaremypower/dsh-session-export'
    const KIND = 'session-export'
    const ROUTE = 'api/session-export.html'
    const COMMAND = 'export-html'

    const CSS = {
      frame: { display: 'block', width: '100%', height: '100%', border: 0, flex: '1 1 auto' },
      wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
      notice: { margin: 'auto', padding: '24px', color: '#9da5a9', font: '12px/1.6 ui-monospace, Menlo, Consolas, monospace', textAlign: 'center' },
      error: { margin: 'auto', padding: '24px', color: '#ea7f81', font: '12px/1.6 ui-monospace, Menlo, Consolas, monospace', textAlign: 'center' },
    }

    function fileStem(sessionId) {
      return String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')
    }

    function download(sessionId) {
      const anchor = document.createElement('a')
      anchor.href = `${ROUTE}?sessionId=${encodeURIComponent(sessionId)}&download=1`
      anchor.download = `dsh-session-${fileStem(sessionId)}.html`
      anchor.click()
    }

    /** Tab body: fetch the export route once per navigation and frame it. */
    function ExportBody(props) {
      const { useTabInfo, sessionId } = props
      const { tab } = useTabInfo()
      const revision = tab.navigation.revision
      const [nonce, setNonce] = useState(0)
      const [state, setState] = useState({ status: 'loading' })
      useEffect(() => {
        const control = new AbortController()
        setState({ status: 'loading' })
        fetch(`${ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { signal: control.signal })
          .then(response => response.ok
            ? response.text()
            : response.text().then((text) => {
                throw new Error(`HTTP ${response.status}${text === '' ? '' : ` ${text}`}`)
              }))
          .then((html) => { if (!control.signal.aborted) setState({ status: 'ready', html }) })
          .catch((error) => {
            if (!control.signal.aborted) {
              setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
            }
          })
        return () => control.abort()
      }, [sessionId, revision, nonce])
      useEffect(() => tab.actions.bindCommands({ refresh: () => { setNonce(n => n + 1) } }), [tab.actions])
      if (state.status === 'error') {
        return h('div', { style: CSS.wrap },
          h('div', { style: CSS.error }, `Export failed: ${state.error}`))
      }
      if (state.status !== 'ready') {
        return h('div', { style: CSS.wrap },
          h('div', { style: CSS.notice }, 'Rendering session…'))
      }
      return h('div', { style: CSS.wrap },
        h('iframe', {
          title: 'Session export',
          sandbox: 'allow-scripts allow-downloads',
          srcDoc: state.html,
          style: CSS.frame,
        }))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: PKG,
        kind: KIND,
        title: () => 'Session export',
        guide: [{
          id: 'export', order: 70,
          title: () => 'Session export',
          description: () => 'Interactive HTML page of this session',
        }],
      }), 'session-export: tab type')
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: PKG,
        inject: (sessionId) => ({ sessionId }),
      }, ExportBody))
      ctx.effect(() => ctx.contextMenus.register({
        id: 'session-export.menu', target: 'sessionHeader', order: 110,
        resolve: ({ sessionId }) => [
          { id: 'view', label: 'View session as HTML', run: () => { ctx.sidebarRight.openTabIn(sessionId, KIND) } },
          { id: 'download', label: 'Download session HTML', run: () => { download(sessionId) } },
        ],
      }), 'session-export: session header menu')
      ctx.on('command/executed', (sessionId, commandName, result) => {
        if (commandName === COMMAND && result.kind === 'success') {
          ctx.sidebarRight.openTabIn(sessionId, KIND)
        }
      })
    }

    module.exports = {
      name: 'session-export',
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'contextMenus'],
      apply,
    }
    return module.exports
  },
})
