/**
 * Render one committed Session-log event sequence as a self-contained
 * interactive HTML document.
 * @param events - committed logical events in seq order, including any inherited prefix.
 * @param options - optional document metadata.
 * @returns a complete HTML document string.
 */
export declare function formatSessionHtml(
  events: readonly { type: string; surfaceOp?: string; data: unknown }[],
  options?: { title?: string; generated?: string | Date },
): string

/** Render a Markdown fragment to escaped HTML (subset: headings, fences, lists, tables, quotes, inline marks). */
export declare function renderMarkdown(source: string): string
