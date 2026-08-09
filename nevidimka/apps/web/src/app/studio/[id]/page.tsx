"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { ContentDraft, ContentVersion, Publication } from "@nevidimka/shared-types";
import { ApiError, apiFetch } from "@/lib/apiClient";
import { Eyebrow, GhostButton, Panel, PrimaryButton } from "@/components/ui";

interface DetailResponse {
  draft: ContentDraft;
  versions: ContentVersion[];
  publication: Publication | null;
}

const STEP_LABEL: Record<ContentVersion["step"], string> = {
  original: "Как есть",
  gentle: "Бережная",
  structured: "Структурная",
  short: "Краткая",
  final: "Финальная",
};

export default function StudioDraftPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await apiFetch<DetailResponse>(`/api/content/${params.id}`);
    setData(res);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function finalize(text: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/content/${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "finalize", text }),
      });
      await load();
      setShowCustom(false);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/content/${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "publish" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось опубликовать");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await apiFetch(`/api/content/${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "cancel" }),
      });
      router.push("/studio");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;

  const { draft, versions } = data;
  const finalVersion = versions.find((v) => v.id === draft.chosenVersionId);
  const candidateVersions = versions.filter((v) => v.step !== "final");

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Студия · {draft.status === "published" ? "опубликовано" : "черновик"}</Eyebrow>

      {draft.status === "published" && (
        <Panel className="mt-4">
          <div className="text-sm text-ink">Опубликовано в канале.</div>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-dim">
            {finalVersion?.text}
          </p>
        </Panel>
      )}

      {draft.status === "failed" && (
        <Panel className="mt-4">
          <div className="text-sm text-ink-dim">Публикация отменена.</div>
        </Panel>
      )}

      {!finalVersion && draft.status === "ready_for_review" && (
        <div className="mt-4 space-y-2">
          {candidateVersions.map((v) => (
            <Panel key={v.id}>
              <div className="mb-1.5 text-xs text-brass">{STEP_LABEL[v.step]}</div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{v.text}</p>
              <PrimaryButton
                className="mt-3"
                disabled={busy}
                onClick={() => finalize(v.text)}
              >
                Выбрать эту версию
              </PrimaryButton>
            </Panel>
          ))}

          {!showCustom ? (
            <GhostButton className="w-full" onClick={() => setShowCustom(true)}>
              Своя версия
            </GhostButton>
          ) : (
            <Panel>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={4}
                className="w-full rounded-sm border border-line bg-panel-raised p-2.5 text-sm text-ink"
              />
              <PrimaryButton
                className="mt-2"
                disabled={busy || !customText.trim()}
                onClick={() => finalize(customText)}
              >
                Выбрать
              </PrimaryButton>
            </Panel>
          )}
        </div>
      )}

      {finalVersion && draft.status !== "published" && draft.status !== "failed" && (
        <div className="mt-4 space-y-3">
          <Panel>
            <Eyebrow>Финальный текст</Eyebrow>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">
              {finalVersion.text}
            </p>
          </Panel>

          {!!finalVersion.privacyFlags?.length && (
            <Panel className="border-warn/40">
              <div className="text-xs text-warn">Возможные риски</div>
              <ul className="mt-2 space-y-1.5">
                {finalVersion.privacyFlags.map((f, i) => (
                  <li key={i} className="text-xs text-ink-dim">
                    «{f.excerpt}» — {f.note}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {error && <div className="text-xs text-warn">{error}</div>}

          <div className="flex gap-2">
            <PrimaryButton disabled={busy} onClick={publish}>
              {busy ? "Публикую…" : "Опубликовать"}
            </PrimaryButton>
            <GhostButton disabled={busy} onClick={cancel}>
              Отмена
            </GhostButton>
          </div>
        </div>
      )}
    </div>
  );
}
