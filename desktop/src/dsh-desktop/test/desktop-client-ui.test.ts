import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

interface ElementLike {
  type: unknown
  props: Record<string, unknown>
}

describe('DSH Desktop client slot occupants', () => {
  it('registers one occupant per brand seat and renders the ABACO emblem', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const appended: Array<{ textContent?: string }> = []
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '' })),
      head: { appendChild: (node: { textContent?: string }) => appended.push(node) }
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()

    // The plugin must not need the DeepSeek primitives anymore.
    const seenRequires: string[] = []
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): ElementLike => ({ type, props: { ...props, children } })
    const plugin = definition!.factory((id) => {
      seenRequires.push(id)
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    plugin.apply({ slots })

    expect(seenRequires).toEqual(['react'])
    expect(plugin.inject).toEqual(['slots'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark'
    ])
    expect(appended).toHaveLength(1)

    const markHtml = (name: string, props: Record<string, unknown>): string => {
      const element = registrations.find(({ config }) => config.name === name)!.component(
        props
      ) as ElementLike
      const inner = element.props.dangerouslySetInnerHTML as { __html: string }
      return inner.__html
    }

    const sidebarMark = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24 }) as ElementLike
    expect(sidebarMark.type).toBe('span')
    expect(sidebarMark.props.className).toBe('abacoBrandMark')
    expect((sidebarMark.props.style as { width: string; height: string }).height).toBe('24px')
    expect(markHtml('sidebar.brand.mark', { size: 24 })).toContain('aria-label="ABACO"')
    expect(markHtml('sidebar.brand.mark', { size: 24 })).toContain('height="24"')

    const sidebarName = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component({}) as ElementLike
    expect(sidebarName.type).toBe('span')
    expect(sidebarName.props.className).toBe('abacoBrandName')
    expect(sidebarName.props.children).toEqual(['ABACO'])

    const heroMark = registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48, className: 'heroFish' }) as ElementLike
    expect(heroMark.type).toBe('span')
    expect(heroMark.props.className).toBe('abacoBrandMark heroFish')
    expect((heroMark.props.style as { width: string; height: string }).height).toBe('48px')
    expect(markHtml('conversation.hero.brand.mark', { size: 48 })).toContain('height="48"')
  })
})
