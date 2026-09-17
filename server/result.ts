// What every tool answers: text for the model, and structuredContent with a `rows` array, since rows
// are the one shape a view can read (the app keeps them as a dataset, the rest as its meta).

export type ToolResult = {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  structuredContent: Record<string, unknown> & { rows: unknown[] }
}

/** About how much text a tool answers with; lines past it are left out, and the text says how many. */
export const TEXT_MAX = 30_000

export function toolResult(text: string, structured: Record<string, unknown> & { rows: unknown[] }): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured }
}

/** The head, then as many lines as fit, then `more(n)` when n lines were left out. */
export function capped(head: string[], lines: string[], more: (left: number) => string, max = TEXT_MAX): string {
  const out = [...head]
  let size = out.join('\n').length
  let kept = 0
  for (const line of lines) {
    if (size + line.length + 1 > max) break
    out.push(line)
    size += line.length + 1
    kept++
  }
  if (kept < lines.length) out.push(more(lines.length - kept))
  return out.join('\n')
}

/** The parts that have something in them, joined. */
export function parts(...items: (string | null | undefined | false)[]): string {
  return items.filter((item): item is string => typeof item === 'string' && item !== '').join(', ')
}
