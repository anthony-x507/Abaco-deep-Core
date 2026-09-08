/**
 * `SkillGenerator` — turn a {@link RecordingSession} into a structured
 * skill by talking to the Claude API.
 *
 * The prompt template is the one mandated by the task spec.  We send
 * the recording as a JSON-encoded user message; Claude replies with a
 * JSON object we parse and validate against {@link GeneratedSkill}.
 *
 * On any network / parsing failure the generator returns
 * `{ ok: false, fallback_available: true, ... }`.  The caller (UI
 * panel) can then offer the user the "guardar recording crudo"
 * fallback — write the original `RecordingSession` to disk without
 * going through Claude.
 *
 * @module desktop/features/browser/skill-generator
 */

import type {
  GeneratedSkill,
  HttpLike,
  RecordingSession,
  SkillGenerationResult,
} from "./types.js";

/**
 * Default fetch implementation.  Uses the global `fetch` (Node 18+).
 */
export const defaultHttp: HttpLike = {
  async fetch(url, init) {
    const res = await globalThis.fetch(url, init);
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
    };
  },
};

/**
 * The exact prompt mandated by the task spec.  Kept here verbatim so
 * a copy-paste regression in tests catches any drift.
 */
export const SKILL_SYSTEM_PROMPT = `Eres un generador de skills. Recibirás una grabación de acciones en un navegador.
Devuelve un JSON con este esquema exacto:
{
  "name": "string",
  "description": "string",
  "trigger_patterns": ["regex1", "regex2"],
  "steps": [
    {"action": "navigate|click|type|wait", "selector": "css or url", "value": "string"}
  ],
  "preconditions": ["el usuario debe estar logueado en X"]
}`;

/**
 * Default model.  Mirrors the `generated_by_model` field on the
 * Python `Skill` dataclass so the two halves agree.
 */
export const DEFAULT_MODEL = "claude-sonnet-4.5";

export interface SkillGeneratorOptions {
  apiKey: string;
  http?: HttpLike;
  model?: string;
  apiUrl?: string;
  /** Hard timeout in ms.  Defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Build a generator with no network: useful for tests and for
 * operator dry-runs against canned recordings.
 */
export function buildOfflineSkillGenerator(
  transformer?: (
    session: RecordingSession,
  ) => GeneratedSkill,
): {
  generate(session: RecordingSession): Promise<SkillGenerationResult>;
} {
  const fn =
    transformer ??
    defaultOfflineTransformer;
  return {
    async generate(session: RecordingSession): Promise<SkillGenerationResult> {
      try {
        const skill = fn(session);
        return { ok: true, skill, model: "offline-stub" };
      } catch (err) {
        return {
          ok: false,
          error: (err as Error).message,
          fallback_available: true,
        };
      }
    },
  };
}

/**
 * Default offline transformer — converts a recording into a skill by
 * walking through the recorded actions one by one.  Used only as a
 * fallback when the Claude API is unreachable.
 */
export function defaultOfflineTransformer(
  session: RecordingSession,
): GeneratedSkill {
  const steps: GeneratedSkill["steps"] = [];
  for (const action of session.actions) {
    if (action.action_type === "screenshot") continue;
    if (action.action_type === "navigate") {
      steps.push({ action: "navigate", selector: action.url });
      continue;
    }
    if (action.action_type === "click") {
      steps.push({
        action: "click",
        selector: action.selector ?? "",
        notes: action.notes,
      });
      continue;
    }
    if (action.action_type === "type") {
      steps.push({
        action: "type",
        selector: action.selector ?? "",
        value: action.text ?? "",
        notes: action.notes,
      });
      continue;
    }
    if (action.action_type === "scroll") {
      // Scrolls are usually noise; keep them as `wait` no-ops with a
      // note so the skill can still mention them.
      steps.push({
        action: "wait",
        notes: action.notes ?? "scroll",
      });
    }
  }
  return {
    name: deriveName(session),
    description: deriveDescription(session),
    trigger_patterns: deriveTriggerPatterns(session),
    steps,
    preconditions: [
      "el usuario debe estar autenticado si la grabación incluye una pantalla de login",
    ],
  };
}

function deriveName(session: RecordingSession): string {
  if (session.title && session.title.length < 60) {
    return `Recorded: ${session.title}`;
  }
  try {
    const u = new URL(session.final_url || "");
    return `Recorded: ${u.hostname}`;
  } catch {
    return `Recording ${session.session_id.slice(0, 8)}`;
  }
}

function deriveDescription(session: RecordingSession): string {
  const clickCount = session.actions.filter((a) => a.action_type === "click").length;
  const typeCount = session.actions.filter((a) => a.action_type === "type").length;
  const navCount = session.actions.filter((a) => a.action_type === "navigate").length;
  return (
    `Recording from ${session.started_at} to ${session.ended_at} — ` +
    `${navCount} navigations, ${clickCount} clicks, ${typeCount} typed fields.`
  );
}

function deriveTriggerPatterns(session: RecordingSession): string[] {
  const host = (() => {
    try {
      return new URL(session.final_url).hostname;
    } catch {
      return "";
    }
  })();
  if (!host) return [];
  // Escape regex metachars.
  const esc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [`^https?://([a-z0-9-]+\\.)*${esc}/?$`];
}

/**
 * Real generator — calls the Claude API.
 */
export class SkillGenerator {
  private readonly apiKey: string;
  private readonly http: HttpLike;
  private readonly model: string;
  private readonly apiUrl: string;
  private readonly timeoutMs: number;

  constructor(options: SkillGeneratorOptions) {
    if (!options.apiKey) {
      throw new Error("SkillGenerator requires apiKey");
    }
    this.apiKey = options.apiKey;
    this.http = options.http ?? defaultHttp;
    this.model = options.model ?? DEFAULT_MODEL;
    this.apiUrl = options.apiUrl ?? "https://api.anthropic.com/v1/messages";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /**
   * Turn a recording into a skill.  Returns either the parsed skill
   * (with the model that produced it) or a structured failure the UI
   * can react to.
   */
  async generate(session: RecordingSession): Promise<SkillGenerationResult> {
    const body = {
      model: this.model,
      max_tokens: 2048,
      system: SKILL_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            task: "Generate a skill from this recording",
            recording: session,
          }),
        },
      ],
    };
    let response: Awaited<ReturnType<HttpLike["fetch"]>>;
    try {
      response = await this.withTimeout(
        this.http.fetch(this.apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        }),
      );
    } catch (err) {
      return {
        ok: false,
        error: `Claude API request failed: ${(err as Error).message}`,
        fallback_available: true,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Claude API returned HTTP ${response.status}`,
        fallback_available: true,
      };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (err) {
      return {
        ok: false,
        error: `Claude API returned non-JSON: ${(err as Error).message}`,
        fallback_available: true,
      };
    }

    const text = extractText(parsed);
    if (!text) {
      return {
        ok: false,
        error: "Claude API response had no text content",
        fallback_available: true,
      };
    }

    let skill: GeneratedSkill;
    try {
      skill = parseSkillJson(text);
    } catch (err) {
      return {
        ok: false,
        error: `Claude returned invalid JSON: ${(err as Error).message}`,
        fallback_available: true,
      };
    }

    try {
      assertWellFormedSkill(skill);
    } catch (err) {
      return {
        ok: false,
        error: `Skill validation failed: ${(err as Error).message}`,
        fallback_available: true,
      };
    }

    return { ok: true, skill, model: this.model };
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout after ${this.timeoutMs}ms`)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Extract the first text block from an Anthropic Messages response.
 * Tolerates both real responses and test fixtures.
 */
export function extractText(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const p = parsed as { content?: unknown };
  if (!Array.isArray(p.content)) return "";
  const blocks = p.content as Array<{ type?: string; text?: string }>;
  for (const block of blocks) {
    if (block && block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return "";
}

/**
 * Pull a JSON object out of the assistant's reply.  Claude tends to
 * wrap its answer in ```json fences; we strip those first.
 */
export function parseSkillJson(text: string): GeneratedSkill {
  let cleaned = text.trim();
  // Strip ``` fences (any language).
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/```\s*$/, "");
  cleaned = cleaned.trim();

  // If there's a JSON object embedded in prose, extract the first one.
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  const obj = JSON.parse(cleaned);
  return obj as GeneratedSkill;
}

/**
 * Validate the structure of a generated skill.  Throws when the
 * response is not actionable.
 */
export function assertWellFormedSkill(skill: GeneratedSkill): void {
  if (!skill || typeof skill !== "object") {
    throw new Error("skill must be an object");
  }
  if (typeof skill.name !== "string" || skill.name.trim() === "") {
    throw new Error("skill.name must be a non-empty string");
  }
  if (typeof skill.description !== "string") {
    throw new Error("skill.description must be a string");
  }
  if (!Array.isArray(skill.trigger_patterns)) {
    throw new Error("skill.trigger_patterns must be an array");
  }
  for (const pattern of skill.trigger_patterns) {
    if (typeof pattern !== "string") {
      throw new Error("trigger_patterns entries must be strings");
    }
    // Compile-check the regex — the Python side uses `re.compile`.
    new RegExp(pattern);
  }
  if (!Array.isArray(skill.steps)) {
    throw new Error("skill.steps must be an array");
  }
  const allowed = new Set(["navigate", "click", "type", "wait", "screenshot"]);
  for (const step of skill.steps) {
    if (!step || typeof step !== "object") {
      throw new Error("each step must be an object");
    }
    if (typeof step.action !== "string" || !allowed.has(step.action)) {
      throw new Error(`step.action must be one of ${Array.from(allowed).join(", ")}`);
    }
  }
  if (!Array.isArray(skill.preconditions)) {
    throw new Error("skill.preconditions must be an array");
  }
}
