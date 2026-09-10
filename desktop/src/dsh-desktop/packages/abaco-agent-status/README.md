# abaco-agent-status

Indicador de estado del agente para **ABACO DEEP HARNES**.

Mientras el agente está generando/pensando muestra un pill **"AGENTE
TRABAJANDO"** (con spinner) en el header de la sesión de chat; cuando termina
desaparece (`null`). En sesiones hijas (subagente) el texto cambia a
**"SUBAGENTE TRABAJANDO"**. El idioma (ES/EN) se elige con
`navigator.language`.

## Cómo funciona

- **Slot:** `conversation.session.header.actions` (declarado por
  `@deepseek-ai/dsh-client-ui-conversation`, scope `session`, kind `list`).
- **Estado:** `useSession((s) => s.running)` — `SessionSnapshot.running` es el
  estado "live" del agente que mantiene el Session controller; es el mismo
  bit que lee el composer del propio harness.
- **Estilo:** variables `--abaco-*` de `abaco-theme` (fallbacks inline), con
  una hoja `<style>` propia inyectada por el plugin (`abaco-agent-status-style`).

## Arquitectura

- `client.js` — plugin Cordis real (web). `inject: ['slots']`; registra una
  entrada con `id: 'abaco-agent-status'`, `order: 0`. Nunca escribe ni lee
  propiedades propias en `ctx` (regla de oro del loader Cordis).
- `index.js` — mitad host inerte (nada que hacer en Node).
- `package.json` — `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-conversation"]`,
  `platform: "web"`.

## Montaje

Ver `build/dsh-desktop.patch.yml` (fila `abaco-agent-status`), la dep
`abaco-agent-status: 0.1.0` en `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` y el
file: dep en el `package.json` raíz del fork.
