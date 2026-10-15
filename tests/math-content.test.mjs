import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMathContent } from '../src/components/mathContent.js'

test('common model delimiters render as inline and block math without changing LaTeX', () => {
  const value = normalizeMathContent(String.raw`因为 \(x\ne0\)，有 \[\frac{x}{x}=1\]。`)
  assert.ok(value.includes(String.raw`$x\ne0$`))
  assert.ok(value.includes(String.raw`$$
\frac{x}{x}=1
$$`))
})

test('code examples and existing dollar math are preserved', () => {
  const source = [
    String.raw`$x^2$ 与 \(x\)`,
    '',
    '`\\(literal\\)`',
    '',
    '~~~latex',
    String.raw`\[literal\]`,
    '~~~',
    '',
    String.raw`\[y=2\]`,
  ].join('\n')
  const value = normalizeMathContent(source)
  assert.ok(value.includes(String.raw`$x^2$ 与 $x$`))
  assert.ok(value.includes('`\\(literal\\)`'))
  assert.ok(value.includes('~~~latex\n\\[literal\\]\n~~~'))
  assert.ok(value.includes('$$\ny=2\n$$'))
})
