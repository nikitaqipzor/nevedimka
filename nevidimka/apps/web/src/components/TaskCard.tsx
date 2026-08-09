"use client";

import { useState } from "react";
import type { Task } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { GhostButton, Panel, PrimaryButton } from "./ui";

const STATUS_LABEL: Record<Task["status"], string> = {
  planned: "запланировано",
  in_progress: "в работе",
  done: "готово",
  partially_done: "частично",
  postponed: "перенесено",
  cancelled: "отменено",
};

export function TaskCard({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"report" | "coach" | null>(null);
  const [inputText, setInputText] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultNote, setResultNote] = useState<string | null>(null);

  async function focusStart() {
    setBusy(true);
    try {
      const res = await apiFetch<{ session: { id: string } }>("/api/today", {
        method: "POST",
        body: JSON.stringify({ action: "focus_start", taskId: task.id }),
      });
      setFocusSessionId(res.session.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function focusStop() {
    if (!focusSessionId) return;
    setBusy(true);
    try {
      await apiFetch("/api/today", {
        method: "POST",
        body: JSON.stringify({ action: "focus_stop", sessionId: focusSessionId }),
      });
      setFocusSessionId(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function postpone() {
    setBusy(true);
    try {
      await apiFetch("/api/today", {
        method: "POST",
        body: JSON.stringify({ action: "postpone", taskId: task.id }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submitReport() {
    if (!inputText.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ needsClarification?: boolean; comment?: string }>(
        "/api/today",
        {
          method: "POST",
          body: JSON.stringify({ action: "report", taskId: task.id, text: inputText }),
        }
      );
      setResultNote(res.comment ?? null);
      if (!res.needsClarification) {
        setPanel(null);
        setInputText("");
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submitCoach() {
    setBusy(true);
    try {
      const res = await apiFetch<{ output: { first_step: string; subtasks: string[]; note?: string } }>(
        "/api/today",
        {
          method: "POST",
          body: JSON.stringify({ action: "coach", taskId: task.id, note: inputText || undefined }),
        }
      );
      setResultNote(
        [`Первый шаг: ${res.output.first_step}`, ...res.output.subtasks.map((s) => `• ${s}`)].join(
          "\n"
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={task.isMainTask ? "border-brass/30" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {task.isMainTask && (
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-brass">
              главная
            </div>
          )}
          <div className="text-sm text-ink">{task.title}</div>
          <div className="mt-1 flex gap-3 font-mono text-[11px] text-ink-faint">
            <span>{STATUS_LABEL[task.status]}</span>
            {task.estimateMinutes && <span>~{task.estimateMinutes} мин</span>}
            {task.completionPercent != null && <span>{task.completionPercent}%</span>}
          </div>
        </div>
      </div>

      {resultNote && (
        <div className="mt-3 whitespace-pre-line rounded-sm border border-line bg-panel-raised p-3 text-xs text-ink-dim">
          {resultNote}
        </div>
      )}

      {panel && (
        <div className="mt-3 space-y-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={panel === "report" ? "Что сделано по факту…" : "На чём застрял (необязательно)…"}
            rows={3}
            className="w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink placeholder:text-ink-faint"
          />
          <div className="flex gap-2">
            <PrimaryButton disabled={busy} onClick={panel === "report" ? submitReport : submitCoach}>
              Отправить
            </PrimaryButton>
            <GhostButton
              onClick={() => {
                setPanel(null);
                setInputText("");
              }}
            >
              Отмена
            </GhostButton>
          </div>
        </div>
      )}

      {!panel && (
        <div className="mt-3 flex flex-wrap gap-2">
          {task.status !== "done" && !focusSessionId && (
            <GhostButton disabled={busy} onClick={focusStart}>
              Начать фокус
            </GhostButton>
          )}
          {focusSessionId && (
            <PrimaryButton disabled={busy} onClick={focusStop}>
              Завершить фокус
            </PrimaryButton>
          )}
          {task.status !== "done" && (
            <GhostButton disabled={busy} onClick={() => setPanel("coach")}>
              Разбить задачу
            </GhostButton>
          )}
          {task.status !== "done" && (
            <GhostButton disabled={busy} onClick={() => setPanel("report")}>
              Отчитаться
            </GhostButton>
          )}
          {task.status !== "done" && task.status !== "postponed" && (
            <GhostButton disabled={busy} onClick={postpone}>
              Перенести
            </GhostButton>
          )}
        </div>
      )}
    </Panel>
  );
}
