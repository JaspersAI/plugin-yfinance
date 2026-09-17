// Figures written the way a cell or a line of text shows them: 1,234.56, 4.85T, +0.32%, 2026-09-16.
// A value that is not a finite number shows as a dash. `display` writes a true minus for the views;
// `plain` writes a hyphen, for the text the model reads.

const DASH = '—'

type Maybe = number | null | undefined

export interface Format {
  fixed(value: Maybe, digits?: number): string
  signed(value: Maybe, digits?: number): string
  big(value: Maybe, digits?: number): string
  /** A value already in percent: 0.32 is 0.32%. */
  percent(value: Maybe, digits?: number): string
  signedPercent(value: Maybe, digits?: number): string
  /** A fraction: 0.0452 is 4.52%. */
  fraction(value: Maybe, digits?: number): string
  /** Yahoo's `priceHint` decimals (up to six) when given, else two, or four under one. */
  price(value: Maybe, hint?: number | null): string
  /** Epoch seconds as the UTC day. */
  day(seconds: Maybe): string
  /** Epoch seconds as the day where the market is, `offset` seconds from UTC. */
  localDay(seconds: Maybe, offset: number): string
  localTime(seconds: Maybe, offset: number): string
}

const SCALES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
]

function finite(value: Maybe): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function grouped(value: number, digits: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

export function formatter(minus: string): Format {
  const fixed = (value: Maybe, digits = 2): string => {
    if (!finite(value)) return DASH
    const shown = grouped(Math.abs(value), digits)
    return value < 0 && /[1-9]/.test(shown) ? `${minus}${shown}` : shown
  }
  const signed = (value: Maybe, digits = 2): string => {
    const shown = fixed(value, digits)
    return finite(value) && value > 0 && /[1-9]/.test(shown) ? `+${shown}` : shown
  }
  const big = (value: Maybe, digits = 2): string => {
    if (!finite(value)) return DASH
    const size = Math.abs(value)
    const scale = SCALES.find(([at]) => size >= at)
    if (!scale) return fixed(value, 0)
    return `${fixed(value / scale[0], digits)}${scale[1]}`
  }
  const percent = (value: Maybe, digits = 2): string => (finite(value) ? `${fixed(value, digits)}%` : DASH)
  const signedPercent = (value: Maybe, digits = 2): string => (finite(value) ? `${signed(value, digits)}%` : DASH)
  const fraction = (value: Maybe, digits = 2): string => (finite(value) ? percent(value * 100, digits) : DASH)
  const price = (value: Maybe, hint?: number | null): string => {
    if (!finite(value)) return DASH
    if (typeof hint === 'number' && Number.isInteger(hint) && hint >= 0) return fixed(value, Math.min(hint, 6))
    return fixed(value, Math.abs(value) < 1 && value !== 0 ? 4 : 2)
  }
  const day = (seconds: Maybe): string => (finite(seconds) ? iso(seconds).slice(0, 10) : '')
  const localDay = (seconds: Maybe, offset: number): string => (finite(seconds) ? iso(seconds + offset).slice(0, 10) : '')
  const localTime = (seconds: Maybe, offset: number): string =>
    finite(seconds) ? iso(seconds + offset).slice(0, 16).replace('T', ' ') : ''
  return { fixed, signed, big, percent, signedPercent, fraction, price, day, localDay, localTime }
}

/** A small positive percent to three significant figures, as an expense ratio reads: 0.0945%, 0.18%. */
export function smallPercent(value: Maybe): string {
  return finite(value) ? `${Number(value.toPrecision(3))}%` : DASH
}

export const display = formatter('−')
export const plain = formatter('-')
