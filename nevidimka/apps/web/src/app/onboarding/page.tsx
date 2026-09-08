"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Eyebrow, GhostButton, Panel, PrimaryButton } from "@/components/ui";

/**
 * Starting a path from the Mini App, without needing the bot.
 *
 * Mirrors apps/bot/src/handlers/onboarding.ts step for step (Day 0 ->
 * commitment -> goal -> length -> directions -> strategist draft -> accept),
 * because PROJECT_SPEC.md section 6 requires both channels to share the
 * backend rather than each owning its own version of the flow. The
 * difference is presentation only: a chat asks one thing per message, a
 * screen can show the whole sequence and let you go back.
 */

const SUGGESTED_DIRECTIONS = ["Создание", "Тело", "Смелость"];

type Step = "intro" | "commitment" | "goal" | "length" | "directions" | "review";

interface MissionDraft {
  title: string;
  description: string;
  directions: string[];
  milestones: { title: string; targetDay: number }[];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [day0Date, setDay0Date] = useState(() => new Date().toISOString().slice(0, 10));
  const [commitmentText, setCommitmentText] = useState("");
  const [goalText, setGoalText] = useState("");
  const [programLength, setProgramLength] = useState<180 | 365>(180);
  const [directions, setDirections] = useState<string[]>([]);
  const [customDirection, setCustomDirection] = useState("");
  const [draft, setDraft] = useState<MissionDraft | null>(null);

  function toggleDirection(name: string) {
    setDirections((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );
  }

  function addCustomDirection() {
    const name = customDirection.trim();
    if (!name || directions.includes(name) || directions.length >= 5) return;
    setDirections((prev) => [...prev, name]);
    setCustomDirection("");
  }

  /** Asks the strategist for a mission proposal; nothing is saved yet. */
  async function requestDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ draft: MissionDraft }>("/api/path", {
        method: "POST",
        body: JSON.stringify({ action: "draft_mission", goalText, programLength, directions }),
      });
      setDraft(res.draft);
      setStep("review");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не удалось сформулировать миссию. Попробуй снова."
      );
    } finally {
      setBusy(false);
    }
  }

  /** Persists the confirmed mission — the equivalent of the bot's "Принять". */
  async function accept() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/path", {
        method: "POST",
        body: JSON.stringify({
          action: "create_mission",
          title: draft.title,
          description: draft.description,
          directions: draft.directions,
          commitmentText,
          programLength,
          day0Date,
          milestones: draft.milestones,
        }),
      });
      router.push("/today");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить. Попробуй снова.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraftMilestone(index: number, patch: Partial<{ title: string; targetDay: number }>) {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            milestones: prev.milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)),
          }
        : prev
    );
  }

  return (
    <div className="px-5 pt-8 pb-8">
      <Eyebrow>Начать путь</Eyebrow>

      {step === "intro" && (
        <div className="mt-6 space-y-4">
          <Panel>
            <p className="text-sm leading-relaxed text-ink">
              Система на {programLength} дней: каждый день один главный шаг, доказательство
              результата и короткий разбор. Ничего нового, пока не закрыто начатое.
            </p>
          </Panel>
          <Panel>
            <div className="text-xs text-ink-dim">День 0 — дата, с которой считается путь</div>
            <input
              type="date"
              value={day0Date}
              onChange={(e) => setDay0Date(e.target.value)}
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
            />
            <div className="mt-2 text-xs text-ink-faint">
              По умолчанию сегодня. Можно поставить прошлую дату, если путь уже начат.
            </div>
          </Panel>
          <PrimaryButton className="w-full" onClick={() => setStep("commitment")}>
            Дальше
          </PrimaryButton>
        </div>
      )}

      {step === "commitment" && (
        <div className="mt-6 space-y-4">
          <Panel>
            <div className="text-xs text-ink-dim">Договор с собой</div>
            <p className="mt-1 text-xs text-ink-faint">
              Своими словами: что обещаешь себе на этот срок. Это увидишь только ты.
            </p>
            <textarea
              value={commitmentText}
              onChange={(e) => setCommitmentText(e.target.value)}
              rows={5}
              placeholder="Обещаю себе доводить начатое до конца, даже когда трудно…"
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
            />
          </Panel>
          <div className="flex gap-2">
            <PrimaryButton disabled={!commitmentText.trim()} onClick={() => setStep("goal")}>
              Дальше
            </PrimaryButton>
            <GhostButton onClick={() => setStep("intro")}>Назад</GhostButton>
          </div>
        </div>
      )}

      {step === "goal" && (
        <div className="mt-6 space-y-4">
          <Panel>
            <div className="text-xs text-ink-dim">Одна главная цель</div>
            <p className="mt-1 text-xs text-ink-faint">
              Одна, не список. AI-стратег превратит её в миссию и этапы — формулировку потом можно
              поправить.
            </p>
            <textarea
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              rows={4}
              placeholder="Собрать и запустить свой продукт, который приносит доход"
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
            />
          </Panel>
          <div className="flex gap-2">
            <PrimaryButton disabled={!goalText.trim()} onClick={() => setStep("length")}>
              Дальше
            </PrimaryButton>
            <GhostButton onClick={() => setStep("commitment")}>Назад</GhostButton>
          </div>
        </div>
      )}

      {step === "length" && (
        <div className="mt-6 space-y-4">
          <Panel>
            <div className="text-xs text-ink-dim">Срок</div>
            <div className="mt-3 flex gap-2">
              {([180, 365] as const).map((len) => (
                <button
                  key={len}
                  onClick={() => setProgramLength(len)}
                  className={`flex-1 rounded-sm border p-3 text-sm ${
                    programLength === len
                      ? "border-brass text-brass"
                      : "border-line text-ink-dim"
                  }`}
                >
                  {len} дней
                </button>
              ))}
            </div>
          </Panel>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => setStep("directions")}>Дальше</PrimaryButton>
            <GhostButton onClick={() => setStep("goal")}>Назад</GhostButton>
          </div>
        </div>
      )}

      {step === "directions" && (
        <div className="mt-6 space-y-4">
          <Panel>
            <div className="text-xs text-ink-dim">Направления развития</div>
            <p className="mt-1 text-xs text-ink-faint">
              По ним будет строиться карта навыков. Можно выбрать предложенные или добавить свои.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[...new Set([...SUGGESTED_DIRECTIONS, ...directions])].map((name) => (
                <button
                  key={name}
                  onClick={() => toggleDirection(name)}
                  className={`rounded-sm border px-3 py-1.5 text-xs ${
                    directions.includes(name)
                      ? "border-brass text-brass"
                      : "border-line text-ink-dim"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={customDirection}
                onChange={(e) => setCustomDirection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomDirection();
                  }
                }}
                placeholder="Своё направление"
                className="flex-1 rounded-sm border border-line bg-panel-raised p-2 text-sm text-ink"
              />
              <GhostButton onClick={addCustomDirection}>Добавить</GhostButton>
            </div>
          </Panel>

          {error && <div className="text-xs text-warn">{error}</div>}

          <div className="flex gap-2">
            <PrimaryButton disabled={busy || directions.length === 0} onClick={requestDraft}>
              {busy ? "Формулирую…" : "Сформулировать миссию"}
            </PrimaryButton>
            <GhostButton onClick={() => setStep("length")}>Назад</GhostButton>
          </div>
        </div>
      )}

      {step === "review" && draft && (
        <div className="mt-6 space-y-4">
          <p className="text-xs text-ink-faint">
            Это предложение AI-стратега. Ничего ещё не сохранено — поправь, если формулировка не
            твоя.
          </p>

          <Panel>
            <div className="text-xs text-ink-dim">Миссия</div>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink-dim"
            />
          </Panel>

          <Panel>
            <div className="text-xs text-ink-dim">Этапы</div>
            <div className="mt-2 space-y-2">
              {draft.milestones.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={programLength}
                    value={m.targetDay}
                    onChange={(e) =>
                      updateDraftMilestone(i, { targetDay: Number(e.target.value) })
                    }
                    className="w-20 rounded-sm border border-line bg-panel-raised p-2 font-mono text-sm text-ink"
                  />
                  <input
                    value={m.title}
                    onChange={(e) => updateDraftMilestone(i, { title: e.target.value })}
                    className="flex-1 rounded-sm border border-line bg-panel-raised p-2 text-sm text-ink"
                  />
                  <GhostButton
                    onClick={() =>
                      setDraft({
                        ...draft,
                        milestones: draft.milestones.filter((_, j) => j !== i),
                      })
                    }
                  >
                    ✕
                  </GhostButton>
                </div>
              ))}
            </div>
            {draft.milestones.length < 5 && (
              <GhostButton
                className="mt-2"
                onClick={() =>
                  setDraft({
                    ...draft,
                    milestones: [
                      ...draft.milestones,
                      { title: "Новый этап", targetDay: programLength },
                    ],
                  })
                }
              >
                Добавить этап
              </GhostButton>
            )}
          </Panel>

          <Panel>
            <div className="text-xs text-ink-dim">Договор с собой</div>
            <p className="mt-2 whitespace-pre-line text-sm text-ink">{commitmentText}</p>
          </Panel>

          {error && <div className="text-xs text-warn">{error}</div>}

          <div className="flex gap-2">
            <PrimaryButton disabled={busy} onClick={accept}>
              {busy ? "Сохраняю…" : "Принять и запустить"}
            </PrimaryButton>
            <GhostButton disabled={busy} onClick={() => setStep("directions")}>
              Переформулировать
            </GhostButton>
          </div>
        </div>
      )}
    </div>
  );
}
