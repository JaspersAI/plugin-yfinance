// Yahoo's JSON read the forgiving way: a field can be missing, null, a plain number, or a number
// wrapped as { raw, fmt } (quoteSummary and the market summary still wrap some with formatted=false).
// State a view reads is the same: main stores it as written. Shared by the server and the views, so
// nothing here touches Node or the DOM.

export type Row = Record<string, unknown>

export function record(value: unknown): Row | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : null
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** The plain objects in a list. */
export function records(value: unknown): Row[] {
  return list(value).filter((item): item is Row => record(item) !== null)
}

/** A finite number, taken out of { raw } when wrapped; null otherwise. */
export function num(value: unknown): number | null {
  const raw = record(value) ? (value as Row)['raw'] : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** A string with something in it, trimmed; null otherwise. */
export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** A fraction as percent (0.0797 is 7.97), rounded past float noise. */
export function percentOf(fraction: number | null): number | null {
  return fraction === null ? null : Math.round(fraction * 1e6) / 1e4
}

export function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
