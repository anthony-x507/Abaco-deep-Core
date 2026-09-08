# ABACO Deep Core

Cross-platform desktop shell inspired by new plugin-based AI technology, designed to push the boundaries of agentic computing.

## What it is

ABACO Deep Core is a portable, plugin-extensible desktop shell that runs local-first, syncs across machines, and embeds a browser the agent can drive while you stay in control.

## Why it exists

Most agent shells force you to choose between closed ecosystems and DIY duct tape. ABACO Deep Core picks a third path: a small, auditable core that you extend with open plugins and keep in sync across every Mac you own.

## Highlights

- **Plugin-first architecture** — discover, load, and unload plugins via Python `entry_points` or `abaco plugins` commands.
- **Mesh sync between Macs** — your chat history, memories, and skills ride a Tailscale mesh with offline-first sync.
- **Voice in and out** — Whisper.cpp for transcription, macOS `say` for synthesis, both 100% on-device.
- **Embedded browser with takeover** — the agent drives the browser while you record your own workflows; recordings become reusable Skills.
- **Phone pairing** — link your phone to the desktop with a single QR code.
- **Auto-update that preserves memory** — every upgrade backs up your data, runs migrations, and rolls back on failure.

## Built for

- Developers who want their agent to follow them across machines.
- Operators who prefer local-first tooling with auditable plugins.
- Teams that need to share workflows as Skills without leaking data.

## Repository

| Branch | Purpose |
|---|---|
| `main` | Stable releases. |
| `develop` | Active development. |

## Stack

- **Shell**: Electron + TypeScript + React.
- **Core**: Python 3.11+ with FastAPI.
- **Sync**: Tailscale mesh with Last-Writer-Wins.
- **Storage**: local JSONL ledgers, SQLite when needed.
- **Build**: electron-builder, unsigned by default until Apple Developer ID arrives.

## Install

```bash
# Download the unsigned .zip from Releases, then:
xattr -dr com.apple.quarantine "/Applications/ABACO Deep Core.app"
```

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide.

## Documentation

- [Quickstart](docs/QUICKSTART.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Sync between Macs](docs/SYNC.md)
- [Compaction](docs/COMPACTION.md)
- [Security](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

MIT — see [LICENSE](LICENSE).

You are free to download, fork, modify, and redistribute. The only requirement is to keep the copyright notice.

## Inspiration

Built with the same spirit as plugin-based agentic shells: small core, big ecosystem, zero lock-in.
