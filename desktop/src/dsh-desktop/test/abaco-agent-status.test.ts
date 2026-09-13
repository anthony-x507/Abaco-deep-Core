import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('abaco-agent-status watermark pulse', () => {
  it('hooks SessionSnapshot.running and declares watermark pulse CSS', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'abaco-agent-status', 'client.js'),
      'utf8'
    )
    expect(source).toContain("useSession((s) => s.running)")
    expect(source).toContain('abaco-chat-watermark')
    expect(source).toContain('abaco-chat-watermark-pulse')
    expect(source).toContain('/abaco-logo-new.png')
    expect(source).toContain('pointer-events: none')
    expect(source).toContain('2000ms')
    expect(source).toContain('ChatWatermark')
    expect(source).toContain("data-abaco-chat-watermark")

    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const styleNodes: Array<{ textContent?: string; id?: string }> = []
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '', className: '', setAttribute() {}, classList: { toggle() {} } })),
      head: { appendChild: (node: { textContent?: string; id?: string }) => styleNodes.push(node) },
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => [])
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        getComputedStyle: () => ({ position: 'relative' }),
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })
    expect(definition).toBeDefined()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
          Fragment: Symbol.for('react.fragment'),
          useEffect: () => undefined
        }
      }
      throw new Error(`unexpected ${id}`)
    })
    const registrations: Array<{ config: { name: string; id?: string } }> = []
    plugin.apply({
      slots: {
        inject: (_n: string, cb: () => unknown) => cb(),
        register: (config: { name: string; id?: string }) => {
          registrations.push({ config })
          return () => undefined
        }
      }
    })
    expect(plugin.inject).toEqual(['slots'])
    expect(registrations[0]?.config.name).toBe('conversation.session.header.actions')
    expect(registrations[0]?.config.id).toBe('abaco-agent-status')
    expect(styleNodes[0]?.textContent).toContain('abaco-chat-watermark-pulse')
  })
})
