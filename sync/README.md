# ABACO Mesh Sync

`sync/` provides offline-first, peer-to-peer synchronization for the `events`, `tickets`, and `faces` JSONL ledgers. A node keeps a UUID-v4 identity, discovers peers with `tailscale status --json`, exposes local HTTP endpoints, signs envelopes with HMAC-SHA256, and merges records using Last-Writer-Wins (`updated_at` or `occurred_at`).

Start by constructing `SyncConfig`, then load `NodeIdentityStore`, `PeerRegistry`, and `LedgerSync`. `MeshClient` sends signed envelopes to a peer's Tailscale IP; `MeshServer` receives them. `SyncAPI` supplies framework-independent handlers that return dictionaries for `/api/sync/identity`, `/peers`, `/state`, `/pull`, `/push`, and `/broadcast`.

The default data and secret location is `~/.abaco/sync`. If Tailscale is unavailable, discovery returns no peers and the local API remains usable. Conflict semantics are deliberately simple: equal timestamps retain the local record, and unrelated records are added. HTTP transport is intentionally unauthenticated at the connection layer; authenticity of envelope contents is provided by HMAC, and the shared secret must be provisioned identically on participating nodes.
