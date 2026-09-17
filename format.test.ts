import assert from 'node:assert/strict'
import { test } from 'node:test'
import { display, plain, smallPercent } from './format.ts'
import { clamp, int, list, num, record, records, text } from './values.ts'

// The helpers the server's text and the views share: Yahoo's JSON read the forgiving way, and figures
// written the way a cell or a line shows them.

test('numbers read plain or wrapped as { raw, fmt }; anything else is null', () => {
  assert.equal(num(1.5), 1.5)
  assert.equal(num({ raw: 0.0452, fmt: '4.52%' }), 0.0452)
  assert.equal(num({}), null)
  assert.equal(num('12'), null)
  assert.equal(num(Number.NaN), null)
  assert.equal(num(null), null)
})

test('text is a trimmed string with words, records are plain objects, lists are arrays', () => {
  assert.equal(text('  Apple '), 'Apple')
  assert.equal(text(''), null)
  assert.equal(text(3), null)
  assert.deepEqual(record({ a: 1 }), { a: 1 })
  assert.equal(record([1]), null)
  assert.equal(record(null), null)
  assert.deepEqual(list([1, 2]), [1, 2])
  assert.deepEqual(list('x'), [])
  assert.deepEqual(records([{ a: 1 }, null, 2, { b: 2 }]), [{ a: 1 }, { b: 2 }])
  assert.equal(int(3), 3)
  assert.equal(int(3.5), undefined)
  assert.equal(clamp(70, 1, 50), 50)
})

test('fixed and signed figures group thousands and use a true minus on screen', () => {
  assert.equal(display.fixed(1234.567), '1,234.57')
  assert.equal(display.fixed(-1.2), '−1.20')
  assert.equal(plain.fixed(-1.2), '-1.20')
  assert.equal(display.fixed(null), '—')
  assert.equal(display.fixed(3, 0), '3')
  assert.equal(display.signed(1.07), '+1.07')
  assert.equal(display.signed(-1.07), '−1.07')
  assert.equal(display.signed(0), '0.00')
})

test('big figures take a scale letter', () => {
  assert.equal(display.big(4851251544064), '4.85T')
  assert.equal(display.big(466822987776), '466.82B')
  assert.equal(display.big(35923957), '35.92M')
  assert.equal(display.big(12300), '12.30K')
  assert.equal(display.big(950), '950')
  assert.equal(display.big(-1371978271), '−1.37B')
  assert.equal(plain.big(-1371978271), '-1.37B')
  assert.equal(display.big(undefined), '—')
})

test('percent figures: already in percent, or a fraction to scale', () => {
  assert.equal(display.percent(0.322933), '0.32%')
  assert.equal(display.signedPercent(11.4385), '+11.44%')
  assert.equal(display.signedPercent(-0.44), '−0.44%')
  assert.equal(display.fraction(0.0452), '4.52%')
  assert.equal(display.fraction(null), '—')
})

test('prices take Yahoo\'s price hint, else two decimals, or four under one', () => {
  assert.equal(display.price(332.41), '332.41')
  assert.equal(display.price(1.1461318), '1.15')
  assert.equal(display.price(1.1461318, 4), '1.1461')
  assert.equal(display.price(1.1461318, 9), '1.146132')
  assert.equal(display.price(0.004), '0.0040')
  assert.equal(display.price(76450.1), '76,450.10')
})

test('a small percent keeps three significant figures', () => {
  assert.equal(smallPercent(0.0945), '0.0945%')
  assert.equal(smallPercent(0.18), '0.18%')
  assert.equal(smallPercent(undefined), '—')
})

test('dates are the day, or the day and time, where the market is', () => {
  // 2026-09-16 13:30 UTC is 09:30 in New York (UTC−4).
  assert.equal(display.day(1789565400), '2026-09-16')
  assert.equal(display.localDay(1789565400, -14400), '2026-09-16')
  assert.equal(display.localTime(1789565400, -14400), '2026-09-16 09:30')
  // Tokyo's 09:00 open is 00:00 UTC; the local day is the one that counts.
  assert.equal(display.localDay(1789603200 - 3600, 32400), '2026-09-17')
  assert.equal(display.day(null), '')
})
