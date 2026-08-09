"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoAsset } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

const STATUS_LABEL: Record<VideoAsset["status"], string> = {
  uploaded: "в очереди",
  processing: "обрабатывается",
  preview_ready: "превью готово",
  confirmed: "подтверждено",
  rendering: "рендерится",
  published: "опубликовано",
  cancelled: "отменено",
  failed: "ошибка",
};

export default function VideoListPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<VideoAsset[] | null>(null);

  useEffect(() => {
    apiFetch<{ assets: VideoAsset[] }>("/api/video").then((res) => setAssets(res.assets));
  }, []);

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Видео-посты</Eyebrow>
      <p className="mt-2 text-xs text-ink-faint">
        Загрузка видео — через бота, команда /video. Здесь можно посмотреть превью и подтвердить
        публикацию.
      </p>

      <div className="mt-4 space-y-2">
        {assets === null && <div className="text-sm text-ink-faint">Загрузка…</div>}
        {assets?.length === 0 && <EmptyState title="Видео пока нет" />}
        {assets?.map((a) => (
          <button key={a.id} onClick={() => router.push(`/studio/video/${a.id}`)} className="block w-full">
            <Panel className="text-left">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink">
                  {a.durationSeconds ? `${Math.round(a.durationSeconds)}с` : "видео"}
                </span>
                <span className="font-mono text-[11px] text-ink-faint">{STATUS_LABEL[a.status]}</span>
              </div>
            </Panel>
          </button>
        ))}
      </div>
    </div>
  );
}
