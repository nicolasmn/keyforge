import { describe, it, expect } from 'vitest'
import { mergeInitialCss } from './originMath'

describe('mergeInitialCss', () => {
  it('parses initialCss declarations into a style record', () => {
    const style = mergeInitialCss({ initialCss: 'width: 80px; background: red;' })
    expect(style.width).toBe('80px')
    expect(style.background).toBe('red')
  })

  it('applies the structured origin LAST — it wins over initialCss', () => {
    const style = mergeInitialCss({
      initialCss: 'transform-origin: 0% 0%;',
      origin: { x: '25%', y: '80%' },
    })
    expect(style['transform-origin']).toBe('25% 80%')
  })

  it('emits nothing when no structured origin is set', () => {
    const style = mergeInitialCss({ initialCss: 'width: 80px;' })
    expect(style['transform-origin']).toBeUndefined()
  })

  it('ignores malformed structured origins instead of emitting them', () => {
    const style = mergeInitialCss({
      initialCss: '',
      origin: { x: '42' } as unknown as { x: string; y: string },
    })
    expect(style['transform-origin']).toBeUndefined()
  })

  it('does not handle visibility — callers spread it after', () => {
    const style = mergeInitialCss({ initialCss: '', origin: { x: '50%', y: '50%' } })
    expect(style.visibility).toBeUndefined()
  })
})
