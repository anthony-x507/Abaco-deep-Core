# abaco-cloud-sync (skeleton)

Sync the same login, presets, sessions and Cordis plugins across every Mac
the user signs into. Backend lives at Fly.io (planned Fase 3).

## Sync tiers (planned)

### Tier 1 — always sync (E2E encrypted)
- Settings, preferences, active agent
- Plugin install list (id + version)
- Session titles (NOT content)

### Tier 2 — opt-in per record
- Session content
- Customer metadata (name, VIN, model, year)
- Programming history

### Tier 3 — never sync (Mac-local only)
- PIN codes
- EEPROM / MCU dumps
- Bitting codes
- Cryptographic secrets (CSN, ISN)
- Stored in macOS Keychain + filesystem, never leaves the device

## Planned dependencies
- Server: Hono + Postgres (Fly.io)
- Auth: GitHub OAuth
- Client: HTTPS with JWT, E2E encryption for Tier 1/2 with per-device keypairs
- Sync engine: pull on login, push on mutation, exponential backoff

## Status
**Skeleton only.** No implementation yet. Will be filled in after the
backend is deployed.