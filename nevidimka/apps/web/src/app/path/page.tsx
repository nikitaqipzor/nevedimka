"use client";

import Link from "next/link";
import { useState } from "react";
import type { MilestoneView } from "@nevidimka/shared-types";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { useLoad } from "@/lib/useLoad";
import { DayGauge } from "@/components/DayGauge";
import { EmptyState, Eyebrow, GhostButton, LoadState, Panel, PrimaryButton } from "@/components/ui";

interface PathResponse {
  state: "no_mission" | "ready";
  mission?: { title: string; description?: string; directions: string[]; commitmentText: string };
  dayNumber?: number;
  programLength?: number;
  milestones?: MilestoneView[];
}

const STATUS_DOT: Record<MilestoneView["status"], string> = {
  current: "bg-brass",
  passed: "bg-ink-faint",
  done: "bg-done",
  planned: "bg-line",
  in_progress: "bg-brass",
  skipped: "bg-ink-faint",
};

/** Which section is currently open for editing — only one at a time. */
type EditMode = null | "mission" | "commitment" | "milestones";

interface MilestoneDraft {
  title: string;
  targetDay: number;
}

export default function PathPage() {
  const {
    data,
    state: loadState,
    error: loadError,
    reload,
  } = useLoad<PathResponse>(() => apiFetch<PathResponse>("/api/path"));

  const [mode, setMode] = useState<EditMode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit buffers. Seeded from `data` when a section is opened, so cancelling
  // discards changes rather than leaving the screen out of sync with the DB.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [directions, setDirections] = useState<string[]>([]);
  const [newDirection, setNewDirection] = useState("");
  const [commitmentText, setCommitmentText] = useState("");
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);

  if (loadState !== "ready" || !data) {
    return <LoadState state={loadState} error={loadError} onRetry={reload} />;
  }

  if (data.state === "no_mission") {
    return (
      <div className="px-5 pt-8">
        <Eyebrow>Путь</Eyebrow>
        <div className="mt-6">
          <EmptyState
            title="Миссия ещё не запущена"
            hint="Можно начать прямо здесь — или командой /start в боте."
          />
          <Link href="/onboarding" className="mt-4 block">
            <PrimaryButton className="w-full">Начать путь</PrimaryButton>
          </Link>
        </div>
      </div>
    );
  }

  const programLength = data.programLength ?? 180;

  function openMission() {
    setTitle(data!.mission?.title ?? "");
    setDescription(data!.mission?.description ?? "");
    setDirections(data!.mission?.directions ?? []);
    setNewDirection("");
    setError(null);
    setMode("mission");
  }

  function openCommitment() {
    setCommitmentText(data!.mission?.commitmentText ?? "");
    setError(null);
    setMode("commitment");
  }

  function openMilestones() {
    setMilestones((data!.milestones ?? []).map((m) => ({ title: m.title, targetDay: m.targetDay })));
    setError(null);
    setMode("milestones");
  }

  function cancel() {
    setMode(null);
    setError(null);
  }

  /** Sends one action and, on success, closes the editor and refetches. */
  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/path", { method: "POST", body: JSON.stringify(body) });
      setMode(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  function addDirection() {
    const name = newDirection.trim();
    if (!name || directions.includes(name) || directions.length >= 5) return;
    setDirections((prev) => [...prev, name]);
    setNewDirection("");
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <DayGauge dayNumber={data.dayNumber ?? 0} programLength={programLength} label="Путь" />

      {/* --- mission --- */}
      {mode === "mission" ? (
        <Panel className="mt-6">
          <Eyebrow>Миссия</Eyebrow>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Описание (можно оставить пустым)"
            className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink-dim"
          />

          <div className="mt-3 text-xs text-ink-dim">Направления</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {directions.map((d) => (
              <button
                key={d}
                onClick={() => setDirections((prev) => prev.filter((x) => x !== d))}
                className="rounded-sm border border-brass px-2 py-0.5 font-mono text-[11px] text-brass"
              >
                {d} ✕
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newDirection}
              onChange={(e) => setNewDirection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDirection();
                }
              }}
              placeholder="Добавить направление"
              className="flex-1 rounded-sm border border-line bg-panel-raised p-2 text-sm text-ink"
            />
            <GhostButton onClick={addDirection}>Добавить</GhostButton>
          </div>

          {error && <div className="mt-3 text-xs text-warn">{error}</div>}

          <div className="mt-3 flex gap-2">
            <PrimaryButton
              disabled={busy || !title.trim() || directions.length === 0}
              onClick={() =>
                save({ action: "update_mission", title, description, directions })
              }
            >
              {busy ? "Сохраняю…" : "Сохранить"}
            </PrimaryButton>
            <GhostButton disabled={busy} onClick={cancel}>
              Отмена
            </GhostButton>
          </div>
        </Panel>
      ) : (
        <Panel className="mt-6">
          <div className="flex items-start justify-between gap-2">
            <div className="text-base text-ink">{data.mission?.title}</div>
            {mode === null && (
              <button
                onClick={openMission}
                className="shrink-0 text-xs text-brass underline underline-offset-2"
              >
                Изменить
              </button>
            )}
          </div>
          {data.mission?.description && (
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{data.mission.description}</p>
          )}
          {!!data.mission?.directions.length && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.mission.directions.map((d) => (
                <span
                  key={d}
                  className="rounded-sm border border-line px-2 py-0.5 font-mono text-[11px] text-slate"
                >
                  {d}
                </span>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* --- commitment --- */}
      {mode === "commitment" ? (
        <Panel className="mt-3">
          <Eyebrow>Договор с собой</Eyebrow>
          <textarea
            value={commitmentText}
            onChange={(e) => setCommitmentText(e.target.value)}
            rows={5}
            className="mt-2 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
          />
          {error && <div className="mt-2 text-xs text-warn">{error}</div>}
          <div className="mt-3 flex gap-2">
            <PrimaryButton
              disabled={busy || !commitmentText.trim()}
              onClick={() => save({ action: "update_mission", commitmentText })}
            >
              {busy ? "Сохраняю…" : "Сохранить"}
            </PrimaryButton>
            <GhostButton disabled={busy} onClick={cancel}>
              Отмена
            </GhostButton>
          </div>
        </Panel>
      ) : (
        <Panel className="mt-3">
          <div className="flex items-start justify-between gap-2">
            <Eyebrow>Договор с собой</Eyebrow>
            {mode === null && (
              <button
                onClick={openCommitment}
                className="shrink-0 text-xs text-brass underline underline-offset-2"
              >
                Изменить
              </button>
            )}
          </div>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-dim">
            {data.mission?.commitmentText}
          </p>
        </Panel>
      )}

      {/* --- milestones --- */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Этапы</Eyebrow>
          {mode === null && (
            <button
              onClick={openMilestones}
              className="text-xs text-brass underline underline-offset-2"
            >
              Изменить
            </button>
          )}
        </div>

        {mode === "milestones" ? (
          <Panel className="mt-3">
            <p className="text-xs text-ink-faint">
              День — от 1 до {programLength}. Порядок не важен, этапы сортируются по дню.
            </p>
            <div className="mt-3 space-y-2">
              {milestones.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={programLength}
                    value={m.targetDay}
                    onChange={(e) =>
                      setMilestones((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, targetDay: Number(e.target.value) } : x
                        )
                      )
                    }
                    className="w-20 rounded-sm border border-line bg-panel-raised p-2 font-mono text-sm text-ink"
                  />
                  <input
                    value={m.title}
                    onChange={(e) =>
                      setMilestones((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                      )
                    }
                    className="flex-1 rounded-sm border border-line bg-panel-raised p-2 text-sm text-ink"
                  />
                  <GhostButton
                    onClick={() => setMilestones((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </GhostButton>
                </div>
              ))}
            </div>

            {milestones.length < 5 && (
              <GhostButton
                className="mt-2"
                onClick={() =>
                  setMilestones((prev) => [
                    ...prev,
                    { title: "Новый этап", targetDay: programLength },
                  ])
                }
              >
                Добавить этап
              </GhostButton>
            )}

            {error && <div className="mt-3 text-xs text-warn">{error}</div>}

            <div className="mt-3 flex gap-2">
              <PrimaryButton
                disabled={busy || milestones.length === 0}
                onClick={() => save({ action: "replace_milestones", milestones })}
              >
                {busy ? "Сохраняю…" : "Сохранить"}
              </PrimaryButton>
              <GhostButton disabled={busy} onClick={cancel}>
                Отмена
              </GhostButton>
            </div>
          </Panel>
        ) : (
          <div className="relative mt-3 space-y-4 border-l border-line pl-4">
            {(data.milestones ?? []).map((m) => (
              <div key={m.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ${STATUS_DOT[m.status]}`}
                />
                <div className="font-mono text-[11px] text-ink-faint">день {m.targetDay}</div>
                <div className="text-sm text-ink">{m.title}</div>
              </div>
            ))}
            {!data.milestones?.length && (
              <div className="text-sm text-ink-faint">Этапы не заданы.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
