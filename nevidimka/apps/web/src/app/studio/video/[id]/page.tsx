"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { VideoAsset } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { Eyebrow, GhostButton, Panel, PrimaryButton } from "@/components/ui";

export default function VideoDetailPage() {
  const params = useParams<{ id: string }>();
  const [asset, setAsset] = useState<VideoAsset | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await apiFetch<{ assets: VideoAsset[] }>("/api/video");
    setAsset(res.assets.find((a) => a.id === params.id) ?? null);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // pipeline runs in the background worker
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function act(action: "confirm" | "cancel") {
    setBusy(true);
    try {
      await apiFetch(`/api/video?id=${params.id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!asset) return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Видео · {asset.status}</Eyebrow>

      {asset.status === "preview_ready" && (
        <div className="mt-4 space-y-3">
          <Panel>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={`/api/video/${asset.id}/file?variant=preview`}
              poster={`/api/video/${asset.id}/file?variant=cover`}
              controls
              className="w-full rounded-sm"
            />
          </Panel>
          <div className="flex gap-2">
            <PrimaryButton disabled={busy} onClick={() => act("confirm")}>
              Подтвердить и опубликовать
            </PrimaryButton>
            <GhostButton disabled={busy} onClick={() => act("cancel")}>
              Отмена
            </GhostButton>
          </div>
        </div>
      )}

      {(asset.status === "uploaded" || asset.status === "processing") && (
        <Panel className="mt-4">
          <div className="text-sm text-ink-dim">
            Обрабатываю: вырезаю паузы, привожу к вертикальному формату, нормализую звук.
          </div>
        </Panel>
      )}

      {(asset.status === "confirmed" || asset.status === "rendering") && (
        <Panel className="mt-4">
          <div className="text-sm text-ink-dim">Рендерю финальную версию и публикую.</div>
        </Panel>
      )}

      {asset.status === "published" && (
        <Panel className="mt-4">
          <div className="text-sm text-ink">Опубликовано в канале.</div>
        </Panel>
      )}

      {(asset.status === "failed" || asset.status === "cancelled") && (
        <Panel className="mt-4">
          <div className="text-sm text-ink-dim">
            {asset.status === "failed" ? `Ошибка: ${asset.errorMessage ?? "неизвестная"}` : "Отменено."}
          </div>
        </Panel>
      )}
    </div>
  );
}
