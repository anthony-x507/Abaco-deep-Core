# Ola 2 / Bloque 2.C — Update / trust surface (digest pin + notarize GAP)

| Campo | Valor |
|-------|--------|
| **repos** | `anthony-x507/Abaco-deep-Core` (gate + docs); Desk notarize = dated GAP |
| **package** | `desktop/.../packages/abaco-effect-broker` |
| **closes** | PASSES-6-10 Pass 9 hardening: update feed digest pin; refuse-launch if broker pins != binary |
| **marker** | `OLA2-BLOQUE-C-UPDATE-FEED-DIGEST-PIN` |
| **out of scope** | Real Apple notarize while Desk F7 HOLD (GH artifact quota / creds) — see GAP file |
| **doctrine** | Tip-of-spear; Jev never grants; no soft-PASS |

## 2.C.1 Update feed digest pin + refuse-launch

> Extends the **partial** plugin pin path (`PINNED_ARTIFACT` / `verifyAdmissions`).
> When an update-feed / build stamp binds a host **binary digest** to **broker pins**,
> launch and `authorize()` **refuse** if those pins do not match.

### Behaviour

1. Pure gate: `decideUpdateFeedLaunch` in `update-feed-digest-pin.mjs`.
2. Binary digest mismatch -> refuse (`binary-digest-mismatch`).
3. Embedded broker pins != feed-bound pins -> refuse (`broker-pin-mismatch`).
4. Version/tag match **alone** never allows launch (`tag-only-insufficient`).
5. Feed artifact check: `decideUpdateFeedArtifactPin` (sha512/sha256) for install path.
6. `sealUpdateFeedLaunchPin` + `gateAuthorizeUpdateFeedPin` wired at start of `authorize()`
   (and `issueTaskGrant` throws on sealed refuse).
7. Unsigned-dev with **no** stamp configured: allow with reason `unconfigured-dev`
   (ADR-003). That is **not** a notarize PASS.

### Tests / CI

- `packages/abaco-effect-broker/tests/update-feed-digest-pin.test.mjs`
- Desktop CI Contract step includes the file
- Explicit assertion: pin mismatch must **not** allow launch

## 2.C.2 Notarize GAP (Desk F7 HOLD)

Apple notarize credentials / GH artifact quota unavailable (Desk F7 HOLD).
Dated GAP only — **not** soft-PASS. Reopen when F7 frees.

See: `docs/frontier/GAP-NOTARIZE-2026-09-23.md`

## Doctrine

- Tip-of-spear; Jev / Atena never grant a pin widen.
- Prefer fail-closed over soft widen.
- Do not weaken MANIFEST_CAPS / digest+SBOM / Bind gates from Ola 1.
- Do not claim notarize PASS while GAP is open.
