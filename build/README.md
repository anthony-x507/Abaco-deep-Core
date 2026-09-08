# ABACO Deep Core — pipeline de build & release (macOS)

Esta carpeta contiene **todo** lo necesario para compilar `ABACO Deep Core.app`
para **macOS arm64 + x64** y publicarlo en GitHub Releases **sin firma**.

> ⚠️ **Estado actual:** la app se distribuye **sin firma y sin notarizar**.
> Cualquier usuario que descargue el `.zip` debe pasar por Gatekeeper una vez
> (ver [Instalación sin firma](#instalación-sin-firma-gatekeeper)).
> Cuando llegue la Apple Developer ID, solo hay que tocar
> [`electron-builder.dev.cjs`](./electron-builder.dev.cjs) y
> [`sign-stub.sh`](./sign-stub.sh) — el resto del pipeline ya está listo.

---

## 📋 Contenido

| Archivo                          | Propósito                                                            |
| -------------------------------- | -------------------------------------------------------------------- |
| `electron-builder.dev.cjs`       | Config de `electron-builder` para builds **sin firma**.              |
| `make.sh`                        | Build entrypoint — produce los `.zip` arm64 + x64.                   |
| `release-mac.sh`                 | Build + genera `latest-mac.yml` + publica en GitHub Releases.        |
| `verify-build.sh`                | Sanity-check del `.app` empaquetado (estructura + Info.plist + smoke). |
| `update-feed-template.json`      | Plantilla documental del feed (electron-updater usa `latest-mac.yml`). |
| `sign-stub.sh`                   | Stub de firma con Developer ID (muestra las env vars necesarias).    |
| `notarize-stub.sh`               | Stub de notarización (muestra las env vars necesarias).              |
| `artifacts/`                     | Carpeta de salida (los `.zip` y `latest-mac.yml`).                   |
| `.gitignore`                     | Excluye artefactos y credenciales locales.                           |

---

## ✅ Requisitos

| Tool       | Versión mínima | Notas                                                       |
| ---------- | -------------- | ----------------------------------------------------------- |
| macOS      | 12 (Monterey)  | Necesario para arm64 nativo; x64 corre también en versiones anteriores. |
| Node.js    | 20.x           | `node -v` debe reportar `v20.x` o superior.                 |
| npm        | 10.x           | Incluido con Node 20.                                       |
| Python     | 3.11+          | Necesario para varios `node-gyp` y para el `core/`.        |
| Xcode CLT  | latest          | Para `codesign`, `ditto` y `xcrun notarytool` (cuando firmemos). |
| `gh` CLI   | 2.40+          | Solo para `release-mac.sh` (`brew install gh`).             |
| `jq`       | 1.6+           | Solo para `release-mac.sh` (`brew install jq`).             |

> 📦 Todas las herramientas (`node`, `python3`, `gh`, `jq`, `xcode-select
> --install`) están disponibles en un solo comando:
>
> ```bash
> brew install node@20 python@3.11 gh jq && xcode-select --install
> ```

---

## 🛠 Build local

```bash
cd abaco-deep-core
./build/make.sh
```

Esto hace:

1. Verifica que `node`, `npm`, `python3`, `shasum`, `ditto` estén en `$PATH`.
2. Localiza el `package.json` de Electron bajo `desktop/`.
3. `npm ci` (o `npm install` si no hay lockfile).
4. `npm run build` (compila main + renderer con `electron-vite`).
5. `electron-builder --mac --arm64 --config build/electron-builder.dev.cjs`.
6. `electron-builder --mac --x64` (mismo config).
7. `verify-build.sh` — extrae cada ZIP y comprueba:
   - `ABACO Deep Core.app/Contents/{MacOS,Info.plist}` existen.
   - `Info.plist` tiene `CFBundleIdentifier = io.abaco.deepcore`.
   - El binario se carga como Mach-O y sobrevive a un smoke-launch headless.
8. Imprime ruta y tamaño de cada artefacto.

Salida esperada:

```
[verify] found 2 zip(s) to verify
[verify] verifying abaco-deep-core-mac-arm64-0.1.0.zip
[verify]   smoke-launching ABACO Deep Core for 8s
[verify]   ok — abaco-deep-core-mac-arm64-0.1.0.zip
[verify] verifying abaco-deep-core-mac-x64-0.1.0.zip
[verify]   ok — abaco-deep-core-mac-x64-0.1.0.zip
BUILD OK
```

### Variables de entorno útiles

| Var                          | Default       | Efecto                                                |
| ---------------------------- | ------------- | ----------------------------------------------------- |
| `SKIP_DEPS=1`                | `0`           | No corre `npm ci` (útil en CI con cache).              |
| `SKIP_BUILD=1`               | `0`           | No corre `npm run build` (usa lo ya compilado).       |
| `ARCHS="arm64"`              | `arm64 x64`   | Empaqueta solo una arquitectura.                      |
| `ELECTRON_BUILDER_CLI_ARGS`  | _(vacío)_    | Args extra para `electron-builder` (ej. `--publish never`). |

---

## 🚀 Release en GitHub

```bash
cd abaco-deep-core
./build/release-mac.sh v0.1.0
```

Esto:

1. Llama a `make.sh` (a menos que pongas `SKIP_MAKE=1`).
2. Calcula **sha512 + size reales** de cada ZIP.
3. Escribe `build/artifacts/latest-mac.yml` (formato que consume
   `electron-updater`).
4. Crea el release con `gh release create v0.1.0 --target v0.1.0`.
5. Sube los `.zip` y `latest-mac.yml` como assets.
6. Si `--draft` no se pasó, marca el release como **publicado** (`--draft=false`).

### Flags

```bash
./build/release-mac.sh v0.1.0 --draft         # crea como draft
./build/release-mac.sh v0.1.0 --prerelease    # marca como prerelease
./build/release-mac.sh v0.1.0 --target main   # apunta el release a main
./build/release-mac.sh v0.1.0 --repo otro/dueño/repo
```

### Variables

| Var              | Default                          | Efecto                                    |
| ---------------- | -------------------------------- | ----------------------------------------- |
| `REPO`           | `anthony-x507/Abaco-deep-Core`   | Override del repo GitHub.                 |
| `SKIP_MAKE=1`    | `0`                              | Reusa artefactos ya construidos.          |
| `SKIP_CREATE=1`  | `0`                              | No crear release; solo sube assets.       |
| `DRY_RUN=1`      | `0`                              | Imprime comandos sin ejecutarlos.         |

> 🔐 Asegúrate de haber corrido `gh auth login` antes. El script **no te
> pregunta credenciales**.

---

## 🍎 Instalación sin firma (Gatekeeper)

macOS moderno (≥ 10.15 Catalina) bloquea por defecto cualquier app que no
esté firmada ni notarizada. Cuando un usuario descarga el `.zip`, Gatekeeper
lo etiquetará como **"ABACO Deep Core.app no se puede abrir porque proviene
de un desarrollador no identificado"**.

Hay **tres formas** de abrir la app:

### Opción 1 — Click derecho (recomendada para usuarios finales)

1. Descargar `abaco-deep-core-mac-arm64-0.1.0.zip`.
2. Doble-click para extraer → queda `ABACO Deep Core.app`.
3. **Click derecho** sobre `ABACO Deep Core.app` → **Abrir**.
4. Aparece un diálogo: click en **Abrir**.
5. macOS recuerda la decisión y a partir de ahí se abre con doble click normal.

### Opción 2 — Quitar la cuarentena globalmente (CLI)

```bash
# Después de mover la app a /Applications:
xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"
```

Esto borra el flag `com.apple.quarantine` de **todos** los archivos del bundle.
La próxima vez que se abra, macOS ya no protestará.

> 💡 Si distribuyes un instalador (pkg/dmg en el futuro), puedes hacer el
> `xattr -dr` dentro del payload antes de empaquetar para que el usuario
> no tenga que hacer nada.

### Opción 3 — Permitir apps de cualquier origen (no recomendado)

```bash
sudo spctl --master-disable
```

Esto desactiva la verificación globalmente. **No se recomienda**: abre la
puerta a apps maliciosas. Volver al default:

```bash
sudo spctl --master-enable
```

> ⚠️ En macOS Sequoia (15) el comando `spctl --master-disable` ya no tiene
> efecto; usa la opción 1 o 2.

---

## 🔄 Auto-updater sin firma

`electron-updater` puede actualizarse desde un feed genérico (cualquier URL
estática que sirva JSON / YAML). El proyecto publica ese feed en:

```
https://github.com/anthony-x507/Abaco-deep-Core/releases/latest/download/latest-mac.yml
```

Cuando un usuario instala una build y la abre, `electron-updater` consulta
ese feed, descarga el ZIP nuevo y lo reemplaza. **Sin firma**, la sustitución
funciona — pero Gatekeeper volverá a aparecer en cada actualización.

### Limitaciones

- macOS **vuelve a mostrar el diálogo** "desarrollador no identificado" para
  cada actualización hasta que el usuario haga click derecho → Abrir otra vez.
- `electron-updater` no firma los binarios por sí solo; lo único que valida
  es el **sha512** del ZIP (campo `sha512` en `latest-mac.yml`). El script
  `release-mac.sh` calcula este hash antes de subirlo, así que un atacante
  que modifique el ZIP será detectado.
- La verificación de firma en Windows (`verifyUpdateCodeSignature`) **no**
  se aplica a macOS — eso es solo para Win32.

### Cómo está configurado

```js
// build/electron-builder.dev.cjs
publish: {
  provider: 'generic',
  url: 'https://github.com/anthony-x507/Abaco-deep-Core/releases/latest/download',
  channel: 'latest'
}
```

En el código de la app (`desktop/src/dsh-desktop/src/main/index.ts` o
similar) inicializa `autoUpdater` con `autoUpdater.setFeedURL({...})` o
deja que `app.updateConfig` lo lea del `package.json`.

---

## 🔐 Cuando llegue el Apple Developer ID

Cuando se apruebe la cuenta, los pasos para firmar son:

### 1. Exportar credenciales

```bash
export APPLE_ID="tu@correo.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"   # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID="ABCDE12345"                           # 10 caracteres
export CSC_LINK="$HOME/certs/DeveloperID_Application.p12"   # o base64 del .p12
export CSC_KEY_PASSWORD="********"
```

### 2. Habilitar firma y notarización en `build/electron-builder.dev.cjs`

```diff
  mac: {
-   hardenedRuntime: false,
-   gatekeeperAssess: false,
-   identity: null,
-   notarize: false,
+   hardenedRuntime: true,
+   gatekeeperAssess: true,
+   identity: "Developer ID Application: Tu Nombre (ABCDE12345)",
+   notarize: true,
  }
```

### 3. Probar

```bash
./build/release-mac.sh v0.1.1 --draft
# Descarga el .zip desde la release draft, descomprime, intenta abrir.
# Si NO aparece el diálogo de Gatekeeper → todo OK.
```

### 4. Publicar

```bash
./build/release-mac.sh v0.1.1   # quita el --draft
```

### Alternativa: keychain temporal en CI

Si usas GitHub Actions y no quieres dejar el `.p12` en el repo, usa el
script `desktop/src/dsh-desktop/scripts/prepare-macos-signing-keychain.mjs`
que ya está en el upstream — crea un keychain temporal, importa el
certificado, y limpia al final. Las variables que espera:

```yaml
env:
  CSC_LINK: ${{ secrets.MACOS_CERT_P12 }}
  CSC_KEY_PASSWORD: ${{ secrets.MACOS_CERT_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

---

## 🧪 Verificación manual de un ZIP

Después de descargar un ZIP de un release real:

```bash
shasum -a 512 abaco-deep-core-mac-arm64-0.1.0.zip
```

Compara el hash con el que aparece en `latest-mac.yml` del mismo release.
Si difieren → el ZIP fue corrompido o manipulado.

Para inspeccionar el bundle sin ejecutarlo:

```bash
ditto -x -k abaco-deep-core-mac-arm64-0.1.0.zip /tmp/abc
/usr/libexec/PlistBuddy -c 'Print' "/tmp/abc/abaco-deep-core-mac-arm64-0.1.0/ABACO Deep Core.app/Contents/Info.plist"
file "/tmp/abc/abaco-deep-core-mac-arm64-0.1.0/ABACO Deep Core.app/Contents/MacOS/ABACO Deep Core"
```

---

## 🐛 Troubleshooting

| Síntoma                                                          | Causa probable                              | Solución                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `npm ci` falla con `EACCES`                                     | `node_modules` con permisos de otro usuario | `sudo rm -rf desktop/src/dsh-desktop/node_modules && ./build/make.sh`    |
| `electron-builder` falla con `cannot find module '...'`          | Falta `npm ci` o `--config` mal apuntado     | Borrar `artifacts/` y volver a correr `./build/make.sh`                  |
| Gatekeeper bloquea la app con "dañado"                           | Cuarantine flag                             | `xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"`     |
| `gh release create` falla con `already exists`                   | Tag ya publicado                            | Usar `SKIP_CREATE=1 ./build/release-mac.sh v0.1.0` para solo re-upload    |
| `verify-build.sh` reporta `BUILD FAILED` y el ZIP es válido       | `PlistBuddy` no en `/usr/libexec`           | Reinstalar Xcode CLT: `xcode-select --install`                           |
| `latest-mac.yml` no aparece en el release                        | `gh release upload` solo subió zips          | Verificar `artifacts/` antes de publicar; el script sube el yml siempre |
| El usuario abre la app, ve "app dañada" sin opción de "Abrir"    | SIP o macOS muy nuevo                        | macOS ≥ 15 puede requerir click-derecho **dos veces** o `xattr`          |

---

## 📎 Estructura esperada después del release

```
build/
├── artifacts/
│   ├── abaco-deep-core-mac-arm64-0.1.0.zip
│   ├── abaco-deep-core-mac-arm64-0.1.0.zip.blockmap
│   ├── abaco-deep-core-mac-x64-0.1.0.zip
│   ├── abaco-deep-core-mac-x64-0.1.0.zip.blockmap
│   └── latest-mac.yml
├── electron-builder.dev.cjs
├── make.sh
├── notarize-stub.sh
├── release-mac.sh
├── sign-stub.sh
├── update-feed-template.json
├── verify-build.sh
├── README.md
└── .gitignore
```

Los `.blockmap` son metadata que `electron-updater` usa para deltas; los
genera `electron-builder` automáticamente.
