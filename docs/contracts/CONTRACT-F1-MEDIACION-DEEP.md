# CONTRACT F1 — Mediación demostrable (Deep Harnes)

**fecha:** 2026-09-11 (checked in 2026-09-22 for Control 1 closeout)  
**repo piloto:** `anthony-x507/Abaco-deep-Core` (app ABACO DEEP HARNES)  
**autoridad:** Anthony → ABACO LEADER → Plugins Frontier (voto) + UNIVERSAL ARQ/ING (ejecución)  
**fuentes:** ChatGPT Astra + consenso Frontier 5/5 sí+enmiendas + papers CaMeL/FIDES/Progent  
**slice:** `CONTRACT-F1-BROKER-GRANTS-ADMISSION-DEEP.md`

## Meta
Demostrar **mediación completa** en un recorrido piloto Janice: ningún efecto protegido sin pasar el autorizador; un worker puede caer sin tumbar el host; datos≠control.

## Los 3 controles
1. **Broker de efectos con grants por tarea** — `A_efectiva = A_tarea ∩ A_plugin ∩ A_delegación ∩ A_política`. Identidad por canal. Deny inmediato fuera de grant.
2. **Ejecución aislada y supervisada** — already on main (F2.1 Pack B strangler-fork).
3. **Admisión inmutable + datos≠control** — already on main (PR #15).

## Entregable día 14
- Recorrido TS (Janice/desktop) + espejo de contrato Python
- Suite fail-closed: denegó · 0 side-effect · audit · contador
- Plugin piloto retirable sin reiniciar el núcleo
- Face/uso mínimo sin añadir autoridad al TCB

## Doctrine delta (Anthony 2026-09-21)
Tip-of-spear plugins: mediación fuerte **sin** matar evolución. Grants/admission evolve via explicit ContractEvolution + HITL, not silent authority growth. Soft-apply keeps disabled plugins disabled and does not freeze admitted plugins. Security ≠ stop evolution.

## Fuera de F1 (candado)
Wasm masivo, CAPMAS hops, Atena en hot-path; Janice=runtime; no rehab disabled; compact 0.90/0.12/8192; never touch `~/Library/Application Support/dsh-desktop/`.

## Criterios aceptación
- Mediación: 0 efectos no autorizados en suite adversarial del alcance
- Contención: crash/block/OOM del worker no reinicia el core
- Revocación: nuevas ops deny ≤1s (piloto local)
- Compact Deep: **0.90 / 0.12** intacto
