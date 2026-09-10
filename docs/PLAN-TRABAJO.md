# PLAN DE TRABAJO — ABACO DEEP HARNES

> Documento vivo de planificación. Actualizado: 2026-09 (sesión de trabajo).
> Este archivo ES la memoria durable del proyecto — si la conversación se compacta,
> todo el estado y lo pendiente vive aquí.

---

## 0. IDENTIDAD DEL PRODUCTO (DECIDIDO)
- **Nombre visible:** ABACO DEEP HARNES
- **appId / bundle id:** `io.abaco.deepcore` (dev: `io.abaco.deepcore.dev`)
- **userData:** `abaco-deep-core` (fijo, NO derivar del nombre)
- **Repo GitHub:** anthony-x507/Abaco-deep-Core (MIT, público)
- **Motor:** fork de DSH Desktop (DeepSeek Harness) — las 226 deps `@deepseek-ai/*` son el motor, NO se renombran. Solo identidad alrededor.
- **Firma:** Developer ID Application: Anthony Sanchez (GKPMCWHU2H), keychain profile `abaco-notary`, APPLE_ID anthonyx507@icloud.com

## 1. ESTADO COMPLETADO (commits en main)
| Commit | Qué |
|---|---|
| `0dc67ba` | Rebrand copy visible DSH Desktop → ABACO (44 reemplazos) |
| `b9806ae` | Desactivar plugins abaco que rompían el loader Cordis (brand/device-identity/cloud-sync/onboarding/experimental) — dejando theme/voice/documents |
| `67300f2` | Quitar ctx.abaco directo de voice/documents client.js |
| `ce0d35c` | Branding ABACO inline SVG (A estilizada) en sidebar/hero — sin DeepSeek wordmark/logo |
| `a87ad39` | Puerto mobile bridge 44127 (43127 colisionaba con DSH Desktop) |
| `dfd7a29` | Branding SVG sizing + LanMobileBridge fallback puerto efímero |
| `87470e8` | **Identidad unificada ABACO DEEP HARNES / io.abaco.deepcore** en 3 configs; feed dshdesktop.com → GitHub; purgar restos DeepSeek (QR, textos) |
| `10935ba` | Plugin **AGENTE TRABAJANDO** (abaco-agent-status) — pill en header de sesión cuando SessionSnapshot.running |

### Otros fixes previos (Fase 1, core Python)
- Repo autocontenido (core/events/envelope mirror, sin sys.path hacks)
- uploads deadlock (RLock), validators anti-traversal
- sync: secreto HMAC aleatorio 0o600, puerto 8765 unificado, LWW tie-break global
- migrations: updater_api import, backup timestamps únicos
- pyproject: versión PEP440, packages reales, deps python-multipart/qrcode
- QR pairing: secret en payload, sin escalada por device_type, admin token, rate limits
- Docs: AUDIT-2026-09.md, DESIGN-compaction.md, TECH-plugin-loading.md

## 2. TRABAJO EN CURSO (subagentes activos)
| Frente | Estado | Subagente |
|---|---|---|
| **F1 Browser**: tools del agente (navigate/click/type/readDOM/screenshot) + RPC loopback main↔harness | Corriendo | `b1a41665` |
| **Rebuild**: .app con AGENTE TRABAJANDO + navegador F0 (npm install + npm run build + unsigned) | Corriendo | `6d066af4` |

### Completado en sesión reciente
| Commit | Qué |
|---|---|
| `265d855` | **F0 Browser**: AbacoBrowserController (overlay WebContentsView, partición aislada persist:abaco-browser, chrome bar child view con URL/back/forward/reload/close), IPC `abaco:browser:*` con guard, global `window.dshAbacoBrowser`, launcher plugin en `sidebar.footer.action`, 16/16 tests |
| `4300f18` | **Diseño memoria 3 capas** (956 líneas): Capa 2 viable vía system-prompt section con text función (nunca compactada, persiste sidecar); Capa 1 configurable por preset de agente; Capa 3 spill ya activo con hueco en output de subagentes background |

## 3. PENDIENTE — PLAN COMPLETO POR FASES

### A. VALIDACIÓN BÁSICA (usuario, manual)
1. Abrir `~/Desktop/ABACO DEEP HARNES.app` (unsigned) → crear conversación → verificar:
   - Botón mic (izquierda casilla) y upload (derecha) aparecen CON sesión abierta
   - La casilla de escribir acepta texto (requiere sesión abierta — el "azul" era el workspace-picker)
2. Confirmar visualmente: logo A ABACO en sidebar (no DeepSeek)

### B. BROWSER EMBEBIDO + TAKEOVER + SKILLS (F0→F3)
- **F0** (en curso): AbacoBrowserController (WebContentsView overlay, sesión partition propia, barra URL, ipcMain abaco:browser:*, global preload window.dshAbacoBrowser, client plugin abaco-browser con botón, montaje en patch) — subagente `8541bcb6`
- **F1**: Tools del agente (navegar/click/type/readDOM/screenshot/wait) vía ctx.tools.register + RPC HTTP loopback main↔harness (patrón lan-mobile-bridge + env DSH_HOME)
- **F2**: Chrome completo (page local + preload abaco-browser.cjs), decoder `__ABACO_REC__` (grabación real de acciones), redacción passwords
- **F3**: Grabación → SKILL.md en `$DSH_HOME/skills/` (dsh-skill-filesystem lo descubre); Claude API opcional con key; fallback heurístico
- Kit reutilizable: desktop/features/browser/{session-cookies, takeover-controller, skill-generator, types, preload-bridge, recorder-parcial}
- Reescribir: browser-view.ts → WebContentsView real; paneles → DOM/preload style

### C. MEMORIA DE CONTEXTO 3 CAPAS (nueva feature)
Modelo (de otro agente del usuario):
1. **Ventana viva**: reciente con tope + resumen automático (mejorar dsh-compaction-basic agresivo)
2. **Memoria durable**: preferencias/proyectos/decisiones que sobreviven a compactación (NO existe hoy)
3. **Delegación**: no llenar ventana con crudo; subagentes devuelven solo resultado útil

- Diseño en curso → `docs/DESIGN-memory-3layer.md` (subagente `a8ef4dbe`)
- Implementación por fases tras el diseño (verificar hooks: agent-loop pre-step, ctx.systemPrompt.section, dsh-credentials/settings/storage)

### D. REGENERAR ICONOS (pendiente de identidad visual)
- `desktop/brand/icon.icns`, app-icon.png, icon-1024.png, fork build/*.png pueden tener arte DeepSeek viejo (paleta púrpura/cian)
- Regenerar desde `desktop/brand/logo.svg` (paleta ABACO navy/azul #3D6FB2→#0E2147)
- Verificar dock/tray/favicon tras regenerar

### E. REBUILD + RELEASE FINAL (tras B, C, D)
1. `npm run build` en fork (regenera out/ con identidad)
2. npm install (relinkea deps file:, regenera package-lock, patch-package)
3. make.sh firmado (Developer ID GKPMCWHU2H) — OJO: no smoke-lanzar automáticamente
4. Verificar Info.plist: io.abaco.deepcore + ABACO DEEP HARNES (nunca io.dsh.desktop)
5. Notarización (cola Apple puede tardar horas — incidente conocido)
6. Release v0.3.x + docs

### F. LIMPIEZA SISTEMA (para cuando el usuario pruebe builds)
- Purgar registros LaunchServices fantasma: `/System/Library/Frameworks/CoreServices.framework/.../lsregister -u <ruta>` para rutas de builds borradas
- NO borrar `~/Library/Application Support/dsh-desktop` (pertenece al DSH Desktop vanilla instalado, que aloja otra sesión)
- NO tocar proyectos ajenos: Abaco Desk, ABACO Hub, AbacoHub, ABACO Dashboard (PID 1800, com.abaco.dashboard)

## 4. REGLAS DE ORO (aprendidas con dolor)
1. **NUNCA lanzar la app automáticamente** (smoke tests con launchctl dejaban jobs que la reabrían sola). El usuario la abre manualmente.
2. **NUNCA** en client.js de plugins: `ctx.algo = X` ni `ctx['prop']` — Cordis rompe todo el árbol ("without provide/inject"). Solo `ctx.slots`.
3. Build con SKIP_DEPS=1 no corre postinstall → PNG de branding no llegan al .app (usar inline SVG o extraResources).
4. macOS confunde apps por CFBundleIdentifier → verificar Info.plist de cada build.
5. Apple Notary Service puede estar en cola horas (incidente documentado) — no bloquearse.
6. La app DSH Desktop vanilla corre en esta Mac (aloja otra sesión) — no matarla ni compartir userData.
7. Delegar trabajo pesado a subagentes para no saturar la ventana de contexto.
8. **`npx` / `npm run` están ROTOS en este shell**: `node` en PATH es un shim (`~/Library/Application Support/dsh-desktop/harness/.desktop-bin/node`) que ejecuta el binario Electron con `ELECTRON_RUN_AS_NODE=1`, y Electron inyecta un argv extra → `Unknown argument`. Para builds usar Node real explícito y PATH saneado:
   `env -u ELECTRON_RUN_AS_NODE CSC_IDENTITY_AUTO_DISCOVERY=false PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" /usr/local/bin/node node_modules/electron-builder/cli.js --mac --arm64 --config <cfg>`
9. **`extraResources` del config base es una LISTA EXPLÍCITA de 12 entradas** (`build/electron-builder.dev.cjs`): cada recurso nuevo (p.ej. `abaco-browser-chrome.html`) hay que AÑADIRLO ahí o no entra en el .app. Esa fue la causa de que el chrome bar faltara en una build.
10. **`patch-package` falla si node_modules ya tiene una revisión anterior del patch aplicada.** Fix: restaurar el manifest prístino desde `packages/harness-0.1.2-rc.1/npm-dsh/deepseek-ai-dsh-0.1.2-rc.1.tgz` y reaplicar.
11. **Si se añade un plugin nuevo**: 3 sitios obligatorios — fila `insert` en `build/dsh-desktop.patch.yml`, dep `"<pkg>": "0.1.0"` en `patches/@deepseek-ai+dsh+0.1.2-rc.1.patch` (¡y actualizar el conteo del hunk `@@ -28,6 +28,N @@`!), y dep `file:packages/<pkg>` en `package.json` del fork. Luego `npm install`.
12. Build unsigned para pruebas (sin cola de Apple ni keychain): override con `mac.identity: null`, `mac.notarize: false`, `CSC_IDENTITY_AUTO_DISCOVERY=false`, y `mac.target: [{target:'dir', arch:['arm64']}]`.

## 5. CONTACTOS / CREDENCIALES (no exponer passwords)
- Apple ID: anthonyx507@icloud.com | Team: GKPMCWHU2H (cert real; 7UFWQWWWR7 era de un cert dev viejo)
- APP_APP_SPECIFIC_PASSWORD: solo en ~/.zshrc, nunca en chat
- Developer ID cert en keychain: "Developer ID Application: Anthony Sanchez (GKPMCWHU2H)"
- CSR/key privada: ~/Desktop/abaco-certs/ (nunca subir al repo)
