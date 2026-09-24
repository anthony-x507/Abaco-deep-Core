# Pin rotation -- release gate (Ola 3 / 3.3)

| Field | Value |
|-------|--------|
| **repos** | `anthony-x507/Abaco-deep-Core` |
| **marker** | `OLA3-BLOQUE-SUPPLY-CHAIN-D6` (shared with D6 stamp) |
| **closes** | PASSES P5 pin rotation as review-time gate + CI constant check |
| **doctrine** | Tip-of-spear; Jev never grants; no runtime rotate API |

## Rule

Changing a pinned digest is a **release gate**, not a runtime feature.

1. Edit shippable subject files listed in `ARTIFACT_FILES`.
2. Run `node scripts/sign-manifest.mjs`.
3. Paste the printed `PINNED_MANIFEST_DIGEST` and `PINNED_ARTIFACT` blocks into
   `packages/abaco-effect-broker/index.js`.
4. Regenerate `author_signature` / binding in each plugin `sbom.admission.json`.
5. Commit is the trust decision (broker source is TCB). Code review required.
6. CI must fail if digests are empty, TODO/placeholder, or drift from on-disk bytes.

## CI check

`packages/abaco-effect-broker/tests/pin-rotation-gate.test.mjs` asserts:

- `PINNED_ARTIFACT` digests are present, non-empty, sha256 hex
- no TODO / TBD / FIXME / zeroed placeholders
- live `hashArtifactFiles` matches each pin
- `PINNED_MANIFEST_DIGEST` entries are non-empty sha256
- this doc and `scripts/sign-manifest.mjs` rotation procedure exist

## What is forbidden

- Runtime `rotatePin` / silent pin widen
- Jev / Atena granting a pin change
- Soft-PASS when digests drift
- Claiming Sigstore for the review-time stamp (see GAP-SIGSTORE-STAMP-ONLY)

## Related

- `scripts/sign-manifest.mjs` -- rotation procedure header
- `docs/frontier/OLA3-BLOQUE.md`
- `docs/contracts/CONTRACT-F1-ADMISSION-IMMUTABLE.md` (pin rotation = review-time)


This path is NOT a Sigstore signature and is stamp-only.
