"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentDraft } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, GhostButton, Panel, PrimaryButton } from "@/components/ui";

interface ContentListResponse {
  drafts: ContentDraft[];
  recentEvidences: { id: string; preview: string }[];
  missions: { id: string; title: string }[];
}

const STATUS_LABEL: Record<ContentDraft["status"], string> = {
  draft: "черновик",
  editing: "редактируется",
  ready_for_review: "готово к выбору",
  confirmed: "подтверждено",
  publishing: "публикуется",
  published: "опубликовано",
  failed: "отменено / ошибка",
};

export default function StudioPage() {
  const router = useRouter();
  const [data, setData] = useState<ContentListResponse | null>(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | undefined>(undefined);

  async function load() {
    const res = await apiFetch<ContentListResponse>("/api/content");
    setData(res);
  }

  useEffect(() => {
    load();
  }, []);

  async function createFromText(sourceText: string, sourceEvidenceId?: string) {
    if (!sourceText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ draft: ContentDraft }>("/api/content", {
        method: "POST",
        body: JSON.stringify({ sourceText, sourceEvidenceId, missionId: selectedMissionId }),
      });
      router.push(`/studio/${res.draft.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Студия контента</Eyebrow>

      {!composing ? (
        <PrimaryButton className="mt-4 w-full" onClick={() => setComposing(true)}>
          Новый пост
        </PrimaryButton>
      ) : (
        <Panel className="mt-4">
          {!!data && data.missions.length > 1 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {data.missions.map((m) => {
                const isSelected = selectedMissionId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMissionId(m.id)}
                    className={`max-w-[50%] shrink-0 truncate whitespace-nowrap rounded-sm px-4 py-2.5 text-sm disabled:opacity-40 ${
                      isSelected ? "bg-brass font-medium text-base" : "border border-line text-ink-dim"
                    }`}
                  >
                    {m.title}
                  </button>
                );
              })}
            </div>
          )}
          {!!data?.recentEvidences.length && (
            <div className="mb-3 space-y-1.5">
              <div className="text-xs text-ink-faint">Из недавней записи:</div>
              {data.recentEvidences.map((e) => (
                <button
                  key={e.id}
                  disabled={busy}
                  onClick={() => createFromText(e.preview, e.id)}
                  className="block w-full rounded-sm border border-line bg-panel-raised px-3 py-2 text-left text-xs text-ink-dim"
                >
                  {e.preview || "…"}
                </button>
              ))}
            </div>
          )}
          <div className="text-xs text-ink-faint">Или напиши текст:</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="О чём пост…"
            className="mt-1.5 w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink placeholder:text-ink-faint"
          />
          <div className="mt-2 flex gap-2">
            <PrimaryButton disabled={busy || !text.trim()} onClick={() => createFromText(text)}>
              {busy ? "Готовлю варианты…" : "Продолжить"}
            </PrimaryButton>
            <GhostButton
              onClick={() => {
                setComposing(false);
                setText("");
              }}
            >
              Отмена
            </GhostButton>
          </div>
        </Panel>
      )}

      <div className="mt-6 space-y-2">
        <Eyebrow>История</Eyebrow>
        {data === null && <div className="mt-2 text-sm text-ink-faint">Загрузка…</div>}
        {data?.drafts.length === 0 && (
          <div className="mt-2">
            <EmptyState title="Постов пока нет" />
          </div>
        )}
        {data?.drafts.map((d) => (
          <button key={d.id} onClick={() => router.push(`/studio/${d.id}`)} className="block w-full">
            <Panel className="mt-2 text-left">
              <div className="line-clamp-2 text-sm text-ink">{d.sourceText}</div>
              <div className="mt-1.5 font-mono text-[11px] text-ink-faint">
                {STATUS_LABEL[d.status]}
              </div>
            </Panel>
          </button>
        ))}
      </div>
    </div>
  );
}
