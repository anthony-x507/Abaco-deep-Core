# `abaco-observability`

**Phase 0 telemetry** for ABACO DEEP HARNES' 3-layer context system.

Every later step of the plan — the subagent spill cap, Principle D, Principle C,
the `abaco-memory` write protocol — is argued from the claim that compaction
degrades the agent. Until this row existed, that claim was an *inference from
reading the engine*: nothing in this product had ever recorded a compaction.
This package records them, so the next step can be judged by a measured Δ
instead of a story.

## What it does

It mounts as a host-plane row and appends **one JSON object per line** to:

```
<DSH_HOME>/logs/abaco-context.jsonl
```

For the ABACO profile that is:

```
~/Library/Application Support/abaco-deep-core/harness/logs/abaco-context.jsonl
```

> The profile matters. `~/Library/Application Support/**dsh-desktop**/harness`
> is the *DeepSeek* app's profile and is not ours. Three earlier audits confused
> the two and reported false facts; always name the profile when reading either.

Nothing here changes engine behaviour. It registers **no service**, adds **no
tool**, writes **no session event**, and takes no decision on the agent's
behalf. It only listens and records.

## What it observes

Every citation below was read from the engine **ABACO actually runs**:

```
$DSH_NM = /Applications/ABACO DEEP HARNES.app/Contents/Resources/app/node_modules/@deepseek-ai
```

There are **three** copies of the engine on this machine, and a claim is only
usable when it names which one it came from — the undefined-`$DSH_NM` shorthand
that resolved to the *DeepSeek* app's bundle is what produced false audits in
this project:

| Copy | Path | Authority |
|---|---|---|
| **ABACO bundle** | `/Applications/ABACO DEEP HARNES.app/…/@deepseek-ai` | **authoritative for runtime** |
| DeepSeek Desktop | `/Applications/DSH Desktop.app/…/@deepseek-ai` | another product |
| Build input (repo) | `desktop/src/dsh-desktop/node_modules/@deepseek-ai` | what the bundle is built from |

Every file cited in this README and in the code was verified **md5-identical
across all three** copies, so the citations hold whichever one is read. They are
written against the ABACO bundle because that is the code ABACO executes. The
three copies are *not* wholly identical elsewhere — the ABACO bundle's
`dsh/package.json` carries the injected ABACO plugin dependencies, and its
rebranded assets differ from the DeepSeek app's.

| Engine signal | Where the contract was read (ABACO bundle) |
|---|---|
| `session/event` firehose: `compaction/start`, `compaction/summary`, `compaction/end`, `compaction/prune`, `tool/call`, `tool/result`, `user/message`, `turn/end` | `dsh-session/lib/index.js:1428-1435`, `:919-966` |
| `agent/status` | `dsh-agent-loop/lib/index.js:386-393` |
| `agent/request-error` (the `CONTEXT_WINDOW_EXCEEDED` path) | `dsh-agent-loop/lib/index.js:660-666`; `dsh-llm/lib/index.js:111` |
| `contextPressure` projection (`pressureTokens`, `projectedTokens`, `contextWindow`) | `dsh-token-meter/lib/index.js:405-409` |
| `tokenMeter.measure(session).totalTokens` | `dsh-token-meter/lib/index.js:620`, `:658` |

## Record kinds

| `event` | Emitted when | Carries |
|---|---|---|
| `self_check` | at mount, then every 5 min | the resolved log path, config validity, counters |
| `compaction_start` | `compaction/start` | `usedBefore`, `measuredTokens`, `estimatedTokens`, `trigger` |
| `compaction_prune` | `compaction/prune` | the shadowed token price of one truncated result |
| `compaction_end` | `compaction/end` | see the table below |
| `turn_failure` | `turn/end` with a failure | failure `code`, `isContextOverflow` |
| `context_overflow` | an overflow request error | which session it was attributed to, and how |
| `agent_status` | `agent/status` | `idle` / `running` |

### `compaction_end` — the deliverable

| Field | Meaning |
|---|---|
| `usedBefore` / `usedAfter` / `deltaTokens` | occupancy before and after, from the engine's own projection and meter |
| `measuredTokens` | `contextPressure.projectedTokens` (provider-sampled), at the start |
| `estimatedTokens` | `tokenMeter.measure().totalTokens` — the number the threshold is actually compared against |
| `spanTokens` / `spanNodes` | the shadowed span's token price and node count |
| `compressionRatio` | `spanTokens / checkpointTokens`, both measured |
| `checkpointChars` / `checkpointTokens` / `checkpointReported` | the checkpoint body's size |
| `truncatedCount` / `truncatedTokens` | how many tool results the pruner replaced, and at what price |
| `attemptsInTurn` / `retries` | compaction attempts made in the same turn |
| `spillCountDelta` / `largeResultsDelta` | spills and over-`maxInlineBytes` results in the span |
| `compactionsTotal` / `overflowsTotal` | session counters |
| `alerts` | `used-not-reduced`, `compaction-failed`, `used-not-measured` |

An alert is the point of the whole package: a compaction that leaves `used` flat
is the failure this phase exists to make visible, and it is never silent.

## Honesty: what this package refuses to invent

The JSONL names its own gaps, because a telemetry stream that reports plausible
guesses is worse than one that reports `null`.

- **`trigger`** is `'overflow'` only when a `CONTEXT_WINDOW_EXCEEDED` failure was
  attributed to the session moments before. `compaction/end.error` is a rendered
  **string**, not the error object (`dsh-compaction-basic/lib/index.js:465` →
  `errorChain`), and `compaction/start` carries no trigger field at all, so
  `triggerSource` states whether the value was attributed or defaulted.
- **`retries`** counts attempts in the same turn. The engine emits **no** retry
  event, so this is the observable definition — not a counter from
  `compactionRetries`.
- **`compressionRatio`** uses a code-point/4 estimate of the checkpoint, because
  the harness does not tokenize it for us. `checkpointChars` travels beside it
  so the reader can redo the arithmetic.
- **`thresholdTokens`** is `null`. The resolved spec is computed per routed model
  inside `compactIfNeeded` and never logged; reporting a number there would be
  exactly the kind of invention this project died from.
- **Degradation signals.** "The agent re-requests something it already had" is
  **measured**: repeated `read`/`grep` call identities after a compaction. The
  other two signs from the specification — contradicting a lock, forgetting a
  recent error — are **not implemented**: they need a semantic judgement about
  the task, and a classifier that guessed would be a fabricated signal.

## Cordis safety

These are the rules the project learned by breaking them (`docs/HANDOFF-FASE5.md`
§2 and §7.3), and each one is honoured here by construction:

- **`apply` is synchronous and returns `undefined`.** An `async` body resolving
  to a Promise is collected as an invalid *effect* (`cordis/lib/index.js:1139`),
  which fails the plugin, which takes the **whole tree** down, which sends the
  app to Safe Mode, which blocks third-party bundles — the reason the owner
  once saw none of ABACO's features. Asynchronous work is started, never
  returned.
- **Services are reached through `ctx.inject([...], cb)` only.** Reading an
  undeclared service property throws, and registering a duplicate service name
  throws. This row declares `['tokenMeter', 'sessionProjections', 'sessions']`
  and registers nothing.
- **No throw can come out of config resolution.** Every `Config` field has a
  `.catch(...)`, the object itself has `.default({}).catch({})`, and
  `resolveObservabilityConfig` is total: it reports rejected values and runs with
  the production defaults. A throw there is FATAL in Cordis.
- **No listener can throw into the engine.** Every handler body is wrapped; a
  telemetry failure becomes one `warn` line and nothing else.
- **A crashed harness still has the evidence.** Records are appended
  synchronously to an `O_APPEND` descriptor, so a record is on disk before the
  event that produced it returns. `asyncWrites: true` trades that away.

## Configuration

Every value below is optional and every default is the production one.

```yaml
- id: abaco-observability
  name: abaco-observability
  config:
    enabled: true
    home: null                 # null ⇒ $DSH_HOME ⇒ ~/.dsh
    logFile: abaco-context.jsonl
    maxInlineBytes: 12000      # the composed spill policy's own ceiling
    maxSessionsTracked: 64
    maxAttemptsPerSession: 64
    maxReadCallsPerSession: 32
    recordPrune: true
    recordToolResults: true
    trackDegradation: true
    asyncWrites: false
```

A malformed value never disables the row: it is reported in a `warn` and in
`self_check.issues`, and the default is used.

## Tests

`test/abaco-observability.test.ts` drives the real code path — a real Cordis
`Context`, a real `SessionStore`, a real `Session`, and the real event firehose —
rather than a double with an invented shape. Every test is mutation-checked: the
code it claims to protect was deliberately broken, the test was observed to go
**red**, and the code was restored.
