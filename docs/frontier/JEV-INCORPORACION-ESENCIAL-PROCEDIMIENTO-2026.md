# Procedimiento esencial — Jev en el día a día (Leader)

| Campo | Valor |
|-------|--------|
| **estado** | **DOCS ONLY** — checklist Leader (~30 s). Cero runtime, cero grants |
| **fecha** | 2026-09-22 ET |
| **pin** | `jev-1.13.0` · schema `advanced_v1` · desk `/workspace/jev-decision-desk/decide_tech.py` (fuera de este árbol) |
| **pisos** | `choice_confidence ≥ 0.55` y `safe_noul ≥ 0.5`. No se bajan sin grant escrito |
| **hermano** | [`JEV-INCORPORACION-ESENCIAL-PLAN-2026.md`](JEV-INCORPORACION-ESENCIAL-PLAN-2026.md) — fases E0–E4 |
| **doctrina** | [`JEV-EVERYDAY-FIVE-MODES-2026.md`](JEV-EVERYDAY-FIVE-MODES-2026.md) · [`JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md`](JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md) · [`JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md`](JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md) |

---

## 1. ¿Llamo? (CALL)

Marca **SÍ** solo si **todas** son verdaderas:

1. Es **técnico** (no gusto, copy, branding, P8).
2. CODE / contrato **ya cortó** grant, authorize, Bind mint, admission, patch.yml — o la pregunta no pide eso.
3. Hay **una** de: (a) 2–4 caminos legales escritos, (b) voy a anunciar PASS/HOLD/cierre, (c) ventana dirty marcada por CODE, (d) cola prefiltrada ≥2 ítems.
4. Hoy llevo **< 12** llamadas Jev.
5. No es P9 (reabrir F1, marketplace, bajar piso).

Si alguna falla → **NO LLAMES**. CODE o Anthony.

---

## 2. ¿Qué modo?

| Situación | Modo |
|-----------|------|
| Voy a decir PASS / “ya quedó” / GAP cerrado | `soft_pass` |
| Dos+ forks técnicos escritos | `fork_ranker` |
| Ordenar bugs/CI/GAPs/PRs (ya prefiltrados) | `potentiality_sorter` |
| Ya falló auto-apply; elijo salida fail-closed | `gray_band` |
| Ventana dirty; ¿preguntar / timing canary / atenuar consejo? | `cadence_pulse` |

Una llamada = un modo = todas las questions en un POST.

Nombres canónicos (voz alta): ver [`JEV-EVERYDAY-FIVE-MODES-2026.md`](JEV-EVERYDAY-FIVE-MODES-2026.md).

---

## 3. ¿Aplico? (APPLY)

**Pisos (locked):**  
`choice_confidence ≥ 0.55` **y** `safe_noul ≥ 0.5` **y** sin candado **y** choice ≠ `hold_for_human`.

**Auto-aplicar (solo clase J — journal / consejo reversible):**  
además `confidence ≥ 0.75` **y** `safe_noul ≥ 0.80` **y** `second_mass ≤ 0.25`.

**Nunca auto-aplicar (clase A):** admisión, anuncio PASS, attenuate, unload, promote canary, merge que cambie grant surface. Ahí: rank + handoff + `execute_ok=false`.

**Entre piso y banda J:** journal + persona (o contrato más estricto).  
**Debajo del piso:** menor blast ya escrito / hold_for_human — **no** inventar grant.

Detalle de bandas y márgenes: [`JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md`](JEV-EVERYDAY-SWEET-SPOT-FORMULA-2026.md).

---

## 4. Después de la llamada

1. Guardar journal (`mode`, `margin_id`, `probabilities`, `apply_ok`, `execute_ok=false`).
2. Si `apply_ok` y clase J → Leader/Cloud sigue ese camino técnico.
3. Si handoff → decirle a Anthony en español corto + audio si es decisión sustancial.
4. Si Soft-PASS = `claim_unsupported` → **no** anunciar PASS.
5. Contar +1 al cupo del día.

---

## 5. Frases prohibidas

- “Jev autorizó / Jev dijo que sí al grant”
- “Soft-PASS” (como si fuera un grant de PASS)
- “Bajamos el piso porque Jev…”
- Loop fijo cada 15s
- Meter Jev en `authorize()` o admission

---

## 6. Arranque esta semana (mínimo viable)

**Día 1–2:** Usar solo Soft-PASS + Fork en decisiones Leader reales; journal a mano si hace falta.  
**Día 3–5:** Cable E1 en `decide_tech` (mode + margin + tope 12).  
**Semana 2:** Sorter en colas stress/GAP/CI.  
**Semana 3:** Gray-band + cadence dirty-only.

Fases completas: plan hermano E0–E4. Potencia tip-of-spear: [`JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md`](JEV-EVERYDAY-POTENTIALITIES-TIP-OF-SPEAR-2026.md).

---

## Límites

- Docs-only. No runtime en este árbol.
- Jev never grants. `execute_ok` siempre falso en consejo de clase A.
- Connectors siguen **HOLD**. F1 no se reabre desde este checklist.
