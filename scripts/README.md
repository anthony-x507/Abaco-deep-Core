# Scripts

Scripts de soporte para abaco-deep-core.

## `verify-all.sh`

```bash
./scripts/verify-all.sh
```

Ejecuta todas las verificaciones estáticas:

- Estructura de carpetas.
- Existencia de archivos clave.
- Sintaxis bash.
- Sintaxis del `electron-builder.dev.cjs`.
- Compilación Python.
- Tests sync.
- Tests de integración.

Exit 0 = todo OK. Exit 1 = algo falló.

## `bootstrap.sh`

```bash
./scripts/bootstrap.sh
./scripts/bootstrap.sh --with-secret ~/secret-from-other-mac.txt
```

Prepara el entorno en una Mac nueva:

1. Verifica Python 3.11+ y Node 20+.
2. Advierte si falta Tailscale.
3. Crea `~/.abaco-deep-core/`.
4. Genera identidad de nodo.
5. Genera o copia el secreto HMAC.

Si no se pasa `--with-secret`, se genera uno nuevo. Para sincronizar con otra Mac, copia el archivo `~/.abaco-deep-core/sync.secret` de una a la otra (o pásalo por un canal seguro).
