/**
 * `skill-modal.tsx` — the modal shown when a recording ends.
 *
 * Layout (per the spec):
 *
 *   ── Skill generado ─────────────────────────────────────────
 *   Nombre:        [auto-fill from preview]                    |
 *   Descripción:   [auto-fill from preview]                    |
 *   Trigger:       [auto-fill from preview]                    |
 *   Pasos:                                                      |
 *     1. navigate https://…                                     |
 *     2. click   #login                                         |
 *     3. type    [name='email'] …                               |
 *   Precondiciones: [list]                                      |
 *   ──────────────────────────────────────────────────────────
 *   [ Guardar ]   [ Editar antes de guardar ]   [ Descartar ]
 *
 * Three exit paths:
 *
 *   * **Guardar** — calls `onSave(skill)` and closes on success.
 *   * **Editar antes de guardar** — flips the modal into "edit"
 *     mode where every field is editable.  The Save button then
 *     uses the edited values.
 *   * **Descartar** — closes without saving.
 *
 * The modal is intentionally self-contained: it does not touch the
 * bridge directly.  The host supplies an `onSave(skill)` callback
 * that does the actual persistence (typically a call to
 * `bridge.saveSkill(...)`).  This keeps the modal unit-testable
 * without a real bridge.
 *
 * @module desktop/features/browser/skill-modal
 */

import * as React from "react";
import type {
  RecordingResult,
  Skill,
  SkillStep,
} from "./preload-bridge.js";

/* ---------------------------------------------------------------- *
 * Public types                                                     *
 * ---------------------------------------------------------------- */

export type SkillSaveOutcome =
  | { ok: true; skillId?: string }
  | { ok: false; error: string };

export interface SkillModalProps {
  /** The skill to preview / edit.  Required. */
  skill: Skill;
  /** The recording the skill was generated from.  Optional — when
   *  provided we show a small "from recording …" hint. */
  recording?: RecordingResult;
  /** Called when the user presses "Guardar".  The host wires this
   *  to `bridge.saveSkill(...)`.  Resolves to an outcome so the
   *  modal can show an error inline. */
  onSave?: (skill: Skill) => Promise<SkillSaveOutcome>;
  /** Called when the modal closes for any reason. */
  onClose: () => void;
  /** Maximum number of step rows to show in the preview.  Defaults
   *  to 5; set higher (or 0) to show all. */
  previewStepLimit?: number;
  /** Override the modal title. */
  title?: string;
  /** Optional className for the dialog element. */
  className?: string;
}

/* ---------------------------------------------------------------- *
 * Helpers                                                          *
 * ---------------------------------------------------------------- */

function cx(...parts: Array<string | undefined | false | null>): string {
  return parts.filter(Boolean).join(" ");
}

function shortId(id: string | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) : id;
}

function cloneStep(step: SkillStep): SkillStep {
  return {
    action: step.action,
    ...(step.selector !== undefined ? { selector: step.selector } : {}),
    ...(step.value !== undefined ? { value: step.value } : {}),
    ...(step.notes !== undefined ? { notes: step.notes } : {}),
  };
}

function cloneSkill(skill: Skill): Skill {
  return {
    ...skill,
    trigger_patterns: [...(skill.trigger_patterns ?? [])],
    steps: (skill.steps ?? []).map(cloneStep),
    preconditions: [...(skill.preconditions ?? [])],
  };
}

/* ---------------------------------------------------------------- *
 * Component                                                        *
 * ---------------------------------------------------------------- */

export const SkillModal: React.FC<SkillModalProps> = ({
  skill: initialSkill,
  recording,
  onSave,
  onClose,
  previewStepLimit = 5,
  title = "Skill generado",
  className,
}) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Skill>(() => cloneSkill(initialSkill));
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const firstFieldRef = React.useRef<HTMLInputElement | null>(null);

  // Reset the draft when the upstream skill changes (e.g. another
  // recording finished before this modal was dismissed).
  React.useEffect(() => {
    setDraft(cloneSkill(initialSkill));
    setSaveError(null);
  }, [initialSkill]);

  // Focus the first editable field when the user switches to edit mode.
  React.useEffect(() => {
    if (editing && firstFieldRef.current) {
      firstFieldRef.current.focus();
    }
  }, [editing]);

  // Trap Escape to close.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stepLimit =
    previewStepLimit > 0
      ? Math.min(previewStepLimit, draft.steps.length)
      : draft.steps.length;
  const visibleSteps = draft.steps.slice(0, stepLimit);
  const hiddenStepCount = Math.max(0, draft.steps.length - stepLimit);

  /* ----------------------------- Handlers ---------------------------- */

  const onSaveClick = React.useCallback(async () => {
    if (saving) return;
    setSaveError(null);
    if (onSave) {
      setSaving(true);
      try {
        const outcome = await onSave(draft);
        if (outcome.ok) {
          onClose();
        } else {
          setSaveError(outcome.error);
        }
      } catch (err) {
        setSaveError((err as Error).message);
      } finally {
        setSaving(false);
      }
    } else {
      // No onSave wired — just close.
      onClose();
    }
  }, [saving, onSave, onClose, draft]);

  const onEditToggle = React.useCallback(() => {
    setEditing((e) => !e);
    setSaveError(null);
  }, []);

  const onDiscard = React.useCallback(() => {
    onClose();
  }, [onClose]);

  const updateField = <K extends keyof Skill>(key: K, value: Skill[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const updateStep = (idx: number, patch: Partial<SkillStep>) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  };

  const removeStep = (idx: number) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.filter((_, i) => i !== idx),
    }));
  };

  const addStep = () => {
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { action: "wait" }],
    }));
  };

  /* ------------------------------ Render ----------------------------- */

  return (
    <div
      className="abaco-skill-modal__backdrop"
      data-testid="skill-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        // Click on the backdrop (not the dialog) closes the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cx("abaco-skill-modal", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="abaco-skill-modal__title"
        data-testid="skill-modal"
        data-editing={editing ? "true" : "false"}
      >
        <header className="abaco-skill-modal__header">
          <h2
            id="abaco-skill-modal__title"
            className="abaco-skill-modal__title"
            data-testid="skill-modal-title"
          >
            {title}
          </h2>
          {recording ? (
            <p
              className="abaco-skill-modal__hint"
              data-testid="skill-modal-hint"
            >
              Generado a partir de la grabación{" "}
              <code>{shortId(recording.session_id)}</code>
              {recording.title ? ` (“${recording.title}”)` : ""}
              {recording.action_count != null
                ? ` — ${recording.action_count} acciones`
                : ""}
              .
            </p>
          ) : null}
        </header>

        {/* ----------------------- Preview / form ----------------------- */}
        <div className="abaco-skill-modal__body">
          {!editing ? (
            <SkillPreview
              skill={draft}
              visibleSteps={visibleSteps}
              hiddenStepCount={hiddenStepCount}
            />
          ) : (
            <SkillForm
              draft={draft}
              onChangeField={updateField}
              onChangeStep={updateStep}
              onRemoveStep={removeStep}
              onAddStep={addStep}
              firstFieldRef={firstFieldRef}
            />
          )}
        </div>

        {saveError ? (
          <p
            className="abaco-skill-modal__error"
            data-testid="skill-modal-error"
            role="alert"
          >
            ⚠ {saveError}
          </p>
        ) : null}

        {/* -------------------------- Footer ---------------------------- */}
        <footer className="abaco-skill-modal__footer">
          <button
            type="button"
            className="abaco-skill-modal__btn abaco-skill-modal__btn--primary"
            data-testid="skill-modal-save"
            onClick={() => void onSaveClick()}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            className="abaco-skill-modal__btn abaco-skill-modal__btn--secondary"
            data-testid="skill-modal-edit"
            onClick={onEditToggle}
            disabled={saving}
          >
            {editing ? "Cancelar edición" : "Editar antes de guardar"}
          </button>
          <button
            type="button"
            className="abaco-skill-modal__btn abaco-skill-modal__btn--ghost"
            data-testid="skill-modal-discard"
            onClick={onDiscard}
            disabled={saving}
          >
            Descartar
          </button>
        </footer>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- *
 * Preview (read-only)                                              *
 * ---------------------------------------------------------------- */

interface SkillPreviewProps {
  skill: Skill;
  visibleSteps: SkillStep[];
  hiddenStepCount: number;
}

const SkillPreview: React.FC<SkillPreviewProps> = ({
  skill,
  visibleSteps,
  hiddenStepCount,
}) => {
  return (
    <div className="abaco-skill-modal__preview" data-testid="skill-modal-preview">
      <dl className="abaco-skill-modal__meta">
        <dt>Nombre</dt>
        <dd data-testid="skill-modal-name">{skill.name || "(sin nombre)"}</dd>

        <dt>Descripción</dt>
        <dd data-testid="skill-modal-description">
          {skill.description || "(sin descripción)"}
        </dd>

        {skill.trigger_patterns && skill.trigger_patterns.length > 0 ? (
          <>
            <dt>Triggers</dt>
            <dd>
              <ul className="abaco-skill-modal__chip-list">
                {skill.trigger_patterns.map((p, i) => (
                  <li key={i}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}

        {skill.preconditions && skill.preconditions.length > 0 ? (
          <>
            <dt>Precondiciones</dt>
            <dd>
              <ul className="abaco-skill-modal__list">
                {skill.preconditions.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>

      <h3 className="abaco-skill-modal__section-title">
        Pasos {visibleSteps.length > 0 ? `(mostrando ${visibleSteps.length})` : ""}
      </h3>
      {visibleSteps.length === 0 ? (
        <p className="abaco-skill-modal__empty">
          Esta grabación no produjo pasos.
        </p>
      ) : (
        <ol className="abaco-skill-modal__steps" data-testid="skill-modal-steps">
          {visibleSteps.map((step, idx) => (
            <li key={idx} className="abaco-skill-modal__step">
              <span className="abaco-skill-modal__step-action">{step.action}</span>
              {step.selector ? (
                <code className="abaco-skill-modal__step-selector">
                  {step.selector}
                </code>
              ) : null}
              {step.value ? (
                <span className="abaco-skill-modal__step-value">
                  = “{step.value}”
                </span>
              ) : null}
              {step.notes ? (
                <span className="abaco-skill-modal__step-notes">
                  <em>({step.notes})</em>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {hiddenStepCount > 0 ? (
        <p
          className="abaco-skill-modal__more"
          data-testid="skill-modal-more-steps"
        >
          …y {hiddenStepCount} paso{hiddenStepCount === 1 ? "" : "s"} más.
        </p>
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------- *
 * Form (editable)                                                  *
 * ---------------------------------------------------------------- */

interface SkillFormProps {
  draft: Skill;
  onChangeField: <K extends keyof Skill>(key: K, value: Skill[K]) => void;
  onChangeStep: (idx: number, patch: Partial<SkillStep>) => void;
  onRemoveStep: (idx: number) => void;
  onAddStep: () => void;
  firstFieldRef: React.MutableRefObject<HTMLInputElement | null>;
}

const ACTIONS: SkillStep["action"][] = [
  "navigate",
  "click",
  "type",
  "wait",
  "screenshot",
];

const SkillForm: React.FC<SkillFormProps> = ({
  draft,
  onChangeField,
  onChangeStep,
  onRemoveStep,
  onAddStep,
  firstFieldRef,
}) => {
  return (
    <form
      className="abaco-skill-modal__form"
      data-testid="skill-modal-form"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="abaco-skill-modal__field">
        <span>Nombre</span>
        <input
          ref={firstFieldRef}
          type="text"
          value={draft.name}
          data-testid="skill-modal-input-name"
          onChange={(e) => onChangeField("name", e.target.value)}
        />
      </label>

      <label className="abaco-skill-modal__field">
        <span>Descripción</span>
        <textarea
          rows={3}
          value={draft.description}
          data-testid="skill-modal-input-description"
          onChange={(e) => onChangeField("description", e.target.value)}
        />
      </label>

      <label className="abaco-skill-modal__field">
        <span>Triggers (uno por línea, regex)</span>
        <textarea
          rows={2}
          value={draft.trigger_patterns.join("\n")}
          data-testid="skill-modal-input-triggers"
          onChange={(e) =>
            onChangeField(
              "trigger_patterns",
              e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
            )
          }
        />
      </label>

      <fieldset className="abaco-skill-modal__steps-edit">
        <legend>Pasos</legend>
        {draft.steps.length === 0 ? (
          <p className="abaco-skill-modal__empty">Sin pasos.</p>
        ) : null}
        {draft.steps.map((step, idx) => (
          <div
            key={idx}
            className="abaco-skill-modal__step-edit"
            data-testid="skill-modal-step-edit"
          >
            <select
              value={step.action}
              aria-label={`Acción del paso ${idx + 1}`}
              onChange={(e) =>
                onChangeStep(idx, {
                  action: e.target.value as SkillStep["action"],
                })
              }
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="selector / url"
              value={step.selector ?? ""}
              onChange={(e) => onChangeStep(idx, { selector: e.target.value })}
            />
            <input
              type="text"
              placeholder="value"
              value={step.value ?? ""}
              onChange={(e) => onChangeStep(idx, { value: e.target.value })}
            />
            <button
              type="button"
              className="abaco-skill-modal__btn abaco-skill-modal__btn--ghost"
              aria-label={`Eliminar paso ${idx + 1}`}
              onClick={() => onRemoveStep(idx)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="abaco-skill-modal__btn abaco-skill-modal__btn--secondary"
          onClick={onAddStep}
        >
          + Añadir paso
        </button>
      </fieldset>
    </form>
  );
};

export default SkillModal;
