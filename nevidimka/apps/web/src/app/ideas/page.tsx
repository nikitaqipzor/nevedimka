"use client";

import { useEffect, useState } from "react";
import type { Idea } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, LoadState, Panel, PrimaryButton } from "@/components/ui";

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "offline">("loading");

  // Also called after add/convert, so it keeps its own function rather than
  // using useLoad. An unhandled rejection here used to leave the screen on
  // "Загрузка…" forever — offline made that the normal outcome.
  async function load() {
    try {
      const res = await apiFetch<{ ideas: Idea[] }>("/api/ideas");
      setIdeas(res.ideas);
      setLoadState("ready");
    } catch {
      setLoadState(
        typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error"
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    try {
      await apiFetch("/api/ideas", { method: "POST", body: JSON.stringify({ text }) });
      setInput("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Хранилище идей</Eyebrow>

      <Panel className="mt-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Новая мысль — не переключаясь на неё сейчас…"
          rows={2}
          className="w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink placeholder:text-ink-faint"
        />
        <PrimaryButton className="mt-2 w-full" disabled={busy} onClick={add}>
          Сохранить
        </PrimaryButton>
      </Panel>

      <div className="mt-4 space-y-2">
        {ideas === null && (
          <LoadState state={loadState} error={null} onRetry={load} />
        )}
        {ideas?.length === 0 && <EmptyState title="Хранилище пусто" />}
        {ideas?.map((idea) => (
          <Panel key={idea.id}>
            <p className="text-sm text-ink">{idea.text}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
