"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Publication } from "@nevidimka/shared-types";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Eyebrow, GhostButton, Panel, PrimaryButton } from "@/components/ui";

const STATUS_LABEL: Record<Publication["status"], string> = {
  pending: "в процессе",
  published: "опубликовано",
  edited: "отредактировано",
  deleted: "удалено",
  failed: "ошибка",
};

export default function PublicationDetailPage() {
  const params = useParams<{ id: string }>();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await apiFetch<{ publication: Publication }>(`/api/publications/${params.id}`);
    setPublication(res.publication);
    setEditText(res.publication.editedHtml ?? res.publication.publishedHtml);
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function saveEdit() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/publications/${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "edit", text: editText }),
      });
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отредактировать.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePost() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/publications/${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить.");
    } finally {
      setBusy(false);
    }
  }

  if (!publication) return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;

  const canModify = publication.status === "published" || publication.status === "edited";
  const currentText = publication.editedHtml ?? publication.publishedHtml;

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Публикация · {STATUS_LABEL[publication.status]}</Eyebrow>

      {error && <div className="mt-3 text-xs text-warn">{error}</div>}

      <Panel className="mt-4">
        <div className="text-xs text-ink-faint">Сейчас в канале</div>
        {editing ? (
          <>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={6}
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised px-3 py-2 text-sm text-ink"
            />
            <div className="mt-2 flex gap-2">
              <PrimaryButton disabled={busy} onClick={saveEdit}>
                Сохранить в канале
              </PrimaryButton>
              <GhostButton onClick={() => setEditing(false)}>Отмена</GhostButton>
            </div>
          </>
        ) : (
          <div className="mt-2 whitespace-pre-wrap text-sm text-ink">{currentText}</div>
        )}
      </Panel>

      {publication.editedHtml && (
        <Panel className="mt-3">
          <div className="text-xs text-ink-faint">Исходный текст при публикации</div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-ink-dim">{publication.publishedHtml}</div>
        </Panel>
      )}

      {canModify && !editing && (
        <div className="mt-3 flex gap-2">
          <GhostButton onClick={() => setEditing(true)}>Редактировать</GhostButton>
          <GhostButton className="border-warn/40 text-warn" disabled={busy} onClick={deletePost}>
            Удалить из канала
          </GhostButton>
        </div>
      )}
      {publication.status === "deleted" && (
        <div className="mt-3 text-sm text-ink-dim">Удалено из канала.</div>
      )}
    </div>
  );
}
