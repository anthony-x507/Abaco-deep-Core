# Cleanup repos and consolidate into Abaco-deep-Core

You are consolidating all `abaco-deep-*` variants into a single public repo called `Abaco-deep-Core`, with English descriptions and an open license.

## Repos to delete (irreversible)

| Repo | Action |
|---|---|
| `Abaco-deep-Harnes` | ❌ Delete (recreated as `Abaco-deep-Core`) |
| `abaco-deep-harnes-fork` | ❌ Delete (empty) |
| `abaco-push-test` | ❌ Delete (push-test artifact) |

## Repos to keep

| Repo | Reason |
|---|---|
| `Abaco-deep-Core` | New home for the project (created in step 3) |
| `Abaco-Universal-harnes-` | Older sibling kept as historical reference |
| `ABACO-DYNO-SCANNER-` | Independent project |
| `JOSECITO-` | Independent project |

## Step 1 — Run the cleanup script

```bash
cd abaco-deep-core
chmod +x scripts/delete-duplicate-repos.sh
./scripts/delete-duplicate-repos.sh
```

The script will:

1. Clone `Abaco-deep-Harnes` to `~/Desktop/abaco-backup-<timestamp>/`.
2. Ask you to type `DELETE` to confirm.
3. Delete the three repos listed above.
4. Print the next steps for creating `Abaco-deep-Core`.

## Step 2 — Create the new repo on GitHub

Open https://github.com/new and fill in:

| Field | Value |
|---|---|
| Repository name | `Abaco-deep-Core` |
| Description | Cross-platform desktop shell inspired by plugin-based agentic tooling. |
| Visibility | Public |
| Initialize with | None (push your own) |

Click **Create repository**.

## Step 3 — Push the backup to the new repo

The script tells you the backup path. Use it like this:

```bash
cd ~/Desktop/abaco-backup-<timestamp>/abaco-deep-harnes
git remote remove origin
git remote add origin https://github.com/anthony-x507/Abaco-deep-Core.git
git push -u origin main
```

## Step 4 — Configure the new repo

After the push, on GitHub go to **Settings**:

- **General → Default branch**: confirm `main`.
- **General → Description**: `Cross-platform desktop shell inspired by plugin-based agentic tooling.`
- **General → Website**: leave blank for now.
- **General → Topics**: `electron`, `python`, `desktop`, `plugin`, `tts`, `whisper`, `tailscale`, `agent`.
- **General → Features**: enable Issues and Pull Requests, disable Wiki.
- **License**: detected from `LICENSE` file (MIT).

## Step 5 — Verify

```bash
gh repo list anthony-x507
```

Expected output:

```text
Abaco-deep-Core            public  2026-09-08
Abaco-Universal-harnes-    public  2026-09-06
ABACO-DYNO-SCANNER-         public  2026-06-25
JOSECITO-                   public  2026-06-09
```

## Files already updated in this repo

- `README.md` — English, describes the project.
- `LICENSE` — MIT, anyone can download and modify.
- `CHANGELOG.md` — English, with the [Unreleased] section listing every feature.

## Inspiration

> "Inspired by new plugin-based AI technology" — the core is intentionally small so the ecosystem grows through plugins, not lock-in.
