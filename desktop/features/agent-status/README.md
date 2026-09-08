# ABACO — Agent Status Indicator

Compact overlay shown while the agent is busy.

## States

| Status | Visible label | Icon |
|---|---|---|
| `idle` | (hidden) | — |
| `thinking` | `AGENTE TRABAJANDO` | spinner + 3 dots |
| `streaming` | `GENERANDO RESPUESTA` | progress bar |
| `tool_use` | `USANDO HERRAMIENTA · <name>` | wrench |
| `done` | `LISTO` (auto-hide after `doneHoldMs`) | check |
| `error` | `ERROR · <message>` | warning + shake |

## Usage

```tsx
import { AgentStatusBar, useAgentStatus } from '@features/agent-status';

const status = useAgentStatus({ status: 'idle' });
return <AgentStatusBar status={status} position="bottom" />;
```

## Theming

Override these CSS custom properties on `:root` to re-skin:

```css
:root {
    --agent-status-thinking:  #22D3EE;
    --agent-status-tool:      #7C3AED;
    --agent-status-streaming: #A78BFA;
    --agent-status-done:      #10B981;
    --agent-status-error:     #F472B6;
}
```

## Accessibility

- `role="status"` + `aria-live="polite"`.
- All animations honour `prefers-reduced-motion`.
- 13px SF Pro Text label, 600 weight, 0.06em letter-spacing.
