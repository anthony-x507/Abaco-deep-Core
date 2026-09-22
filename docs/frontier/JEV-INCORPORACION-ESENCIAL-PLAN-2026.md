# Plan — Incorporar Jev a lo esencial (Abaco)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — plan Leader. Cero runtime, cero `authorize()`, cero `patch.yml`, cero admisión |
| **fecha** | 2026-09-22 ET |
| **orden** | Anthony — armar plan + procedimiento esencial |
| **fuentes** | Deep [#47](https://github.com/anthony-x507/Abaco-deep-Core/pull/47) modos · [#48](https://github.com/anthony-x507/Abaco-deep-Core/pull/48) fórmula · [#49](https://github.com/anthony-x507/Abaco-deep-Core/pull/49) potencialidades · desk `advanced_v1` |
| **mesa** | `decide_tech.py` en `advanced_v1` (fuera de este árbol). Pin `jev-1.13.0` |
| **candados** | Jev never grants · nunca `authorize()` / Bind mint / admission / `patch.yml` · tip-of-spear · pisos 0.55/0.5 no bajar sin grant escrito |
| **hermano** | [`JEV-INCORPORACION-ESENCIAL-PROCEDIMIENTO-2026.md`](JEV-INCORPORACION-ESENCIAL-PROCEDIMIENTO-2026.md) — checklist de 30 s |

Cross-links (doctrina ya en frontier):

- [`JEV-EVERYDAY-FIVE-MODES-2026.md`](JEV-EVERYDAY-FIVE-MODES-2026.md) — cinco modos (fork, gray-band, sorter, soft-PASS, cadence)
- [`JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md`](JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md) — cuándo llamar, bandas, márgenes (PR #48)
- [`JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md`](JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md) — tip-of-spear / potencia cotidiana (PR #49)

---

## Qué es “lo esencial” (y qué no)

**Sí (esencial):**

1. Un **procedimiento Leader** de cuándo llamar / aplicar / saltar.
2. **Journal** con `mode`, `margin_id`, `probabilities`, `execute_ok=false`.
3. Activar **2 modos primero:** Soft-PASS detector + Fork ranker.
4. Luego **1 sorter** para cola (bugs/CI/GAPs/PRs).
5. Cadence pulse **solo** sobre ventanas ya dirty (no loop 15s).

**No (fuera de esencial ahora):**

- Jev dentro del hot path de authorize / admission
- Bajar floors
- Pulse 15s / spam
- Sustituir gustos de Anthony (P8)
- Reabrir F1 / marketplace / connectors (P9)
- Unificar BTC paper en esta mesa (carril aparte; solo copia patrón)

---

## Fases

### E0 — Congelar doctrina (hoy / 1 día)

- [ ] Merge o dejar listos drafts #47 #48 #49 (o este pack de incorporación).
- [ ] Este plan + procedimiento firmados como carril Leader.
- [ ] Checklist de 30 segundos pegado en memoria Leader (ver procedimiento hermano).

### E1 — Cable desk (1–3 días)

- [ ] `decide_tech.py` acepta `mode` ∈ {fork_ranker, gray_band, potentiality_sorter, soft_pass, cadence_pulse}.
- [ ] Journal escribe: `mode`, `margin_id` (M0–M7), `class` (J|A), `probabilities`, `runner_up`, `floors_ok`, `apply_ok`, `execute_ok=false`.
- [ ] Auto-apply solo clase **J** (consejo reversible journal) con: conf≥0.75 · noul≥0.80 · second_mass≤0.25 · no hold_for_human · no candado.
- [ ] Clase **A** (admisión / anuncio PASS / attenuate / promote): `apply_ok=false` siempre; solo rank + handoff.
- [ ] Tope: contador diario ≤12 llamadas; hard stop.

### E2 — Modos vivos mínimos (semana 1)

| Orden | Modo | Disparador Leader | Salida |
|------|------|-------------------|--------|
| 1 | Soft-PASS detector | Antes de decir PASS / HOLD / GAP cerrado | evidence_binds / claim_unsupported / hold_for_human |
| 2 | Fork ranker | ≥2 caminos técnicos legales escritos | choice + runner-up; apply solo si clase J y bandas |
| 3 | Potentiality sorter | Cola ≥2 ítems prefiltrados CODE | orden; P8/P9 fuera |

### E3 — Gray-band + cadence (semana 2–3)

- Gray-band: solo filas que ya fallaron auto-apply; elige salida fail-closed escrita.
- Cadence: solo si CODE marcó dirty; silencio si quiet; consejos attenuate/canary con TTL, `execute_ok=false`.

### E4 — Calibración 30/60/90

- **30d:** toda fila con margin_id; sin probabilities → M3–M7 handoff.
- **60d:** tabla sombra desacuerdo humano vs Jev (mín. 30 filas etiquetadas).
- **90d:** retirar modo que no cambió ninguna decisión; no bajar pisos sin tabla + grant Anthony.

---

## Criterio de éxito esencial

| Señal | Meta |
|-------|------|
| Soft-PASS falsos anunciados | ↓ (claims sin hash no salen) |
| Bifurcaciones sin contrato | Rankeadas con runner-up visible |
| Llamadas/día | ≤12 · costo ≲ $0.05 |
| Grants / authorize tocados por Jev | **0** |
| Flota admitida congelada por Jev | **0** |

---

## Dueños

| Pieza | Dueño |
|-------|-------|
| Procedimiento diario | ABACO LEADER |
| Desk `decide_tech` | Leader / executor box |
| Docs Deep Core | Este PR → merge cuando Auto-review |
| BTC paper | Carril aparte (no mezclar) |
| Authorize / Bind / canary execute | CODE / Janice — nunca Jev |

---

## Límites

- Docs-only en este árbol. No añade cliente, clave, ni import en `authorize()`, Bind, admisión o pin.
- No mergea a `main` por sí solo.
- No mueve F1, connectors (siguen **HOLD**), ni el pin `jev-1.13.0`.
- Jev rankea. Janice ejecuta. Atena aconseja. La seguridad niega lo no autorizado.
