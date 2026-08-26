"use client";

import { useEffect, useRef, useState } from "react";
import type { MentorMessage } from "@nevidimka/shared-types";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Eyebrow, PrimaryButton } from "@/components/ui";

interface MissionOption {
  id: string;
  title: string;
}

type MissionPillOption = MissionOption | { id: undefined; title: string };

export default function MentorPage() {
  const [messages, setMessages] = useState<MentorMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [missions, setMissions] = useState<MissionOption[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ messages: MentorMessage[] }>("/api/mentor").then((res) => setMessages(res.messages));
    // Only used to build the goal-selector pill row below (only shown when
    // 2+ missions come back) — this mirrors the exact threshold the backend
    // already uses to decide single-mission-auto vs. multi-goal-summary
    // framing, so the frontend doesn't need to duplicate that logic.
    apiFetch<{ state: string; missions?: MissionOption[] }>("/api/path").then((res) => {
      if (res.state === "list" && res.missions) setMissions(res.missions);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, userId: "", role: "user", content: text, createdAt: new Date().toISOString() },
    ]);
    setBusy(true);
    try {
      const res = await apiFetch<{ reply: MentorMessage }>("/api/mentor", {
        method: "POST",
        body: JSON.stringify({ message: text, missionId: selectedMissionId }),
      });
      setMessages((m) => [...m, res.reply]);
    } catch (err) {
      // apiFetch/ApiError carries no separate machine-readable code field —
      // it folds the server's `code` into `.message` whenever the response
      // has no `message` of its own (see apiClient.ts), which is exactly
      // the case for the 422 NO_ACTIVE_MISSION response — so matching on
      // that exact string is the reliable way to detect it here.
      if (err instanceof ApiError && err.message === "NO_ACTIVE_MISSION") {
        setError("Сначала нужна активная цель.");
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось отправить сообщение.");
      }
    } finally {
      setBusy(false);
    }
  }

  const pillOptions: MissionPillOption[] = [{ id: undefined, title: "Все цели" }, ...missions];

  return (
    <div className="flex h-dvh flex-col px-5 pt-6">
      <Eyebrow>AI-наставник</Eyebrow>

      {missions.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {pillOptions.map((opt) => {
            const isSelected = selectedMissionId === opt.id;
            return (
              <button
                key={opt.id ?? "all"}
                onClick={() => setSelectedMissionId(opt.id)}
                className={`max-w-[50%] shrink-0 truncate whitespace-nowrap rounded-sm px-4 py-2.5 text-sm disabled:opacity-40 ${
                  isSelected ? "bg-brass font-medium text-base" : "border border-line text-ink-dim"
                }`}
              >
                {opt.title}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pb-4">
        {!messages.length && (
          <div className="text-sm text-ink-faint">
            Спроси про сегодняшний план, застревание на задаче или общий прогресс.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-md px-3 py-2 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-auto bg-panel-raised text-ink"
                : "border border-line bg-panel text-ink"
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className="pb-2 text-xs text-warn">{error}</div>}

      <div className="flex gap-2 border-t border-line pb-4 pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Сообщение…"
          className="flex-1 rounded-sm border border-line bg-panel-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint"
        />
        <PrimaryButton disabled={busy} onClick={send}>
          →
        </PrimaryButton>
      </div>
    </div>
  );
}
