import type { Context } from '@deepseek-ai/cordis'

export declare const name = 'session-export'
export declare const inject: readonly ['commands']
export declare const SESSION_EXPORT_PATH: '/api/session-export.html'
export declare const SESSION_EXPORT_ROUTE: 'api/session-export.html'

export interface Config {
  /** Slash command name to register; defaults to `export-html`. Must match `/^[a-z][a-z0-9_-]*$/`. */
  command?: string
}

export declare function apply(ctx: Context, config: Config): void
