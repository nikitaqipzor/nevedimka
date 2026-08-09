"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Publication } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

const STATUS_LABEL: Record<Publication["status"], string> = {
  pending: "в процессе",
  published: "опубликовано",
  edited: "отредактировано",
  deleted: "удалено",
  failed: "ошибка",
};

export default function PublicationHistoryPage() {
  const router = useRouter();
  const [publications, setPublications] = useState<Publication[] | null>(null);

  useEffect(() => {
    apiFetch<{ publications: Publication[] }>("/api/publications").then((res) =>
      setPublications(res.publications)
    );
  }, []);

  return (
    <div className="px-5 pt-6">
      <Eyebrow>История публикаций</Eyebrow>

      <div className="mt-4 space-y-2">
        {publications === null && <div className="text-sm text-ink-faint">Загрузка…</div>}
        {publications?.length === 0 && <EmptyState title="Публикаций пока нет" />}
        {publications?.map((p) => (
          <button
            key={p.id}
            onClick={() => router.push(`/studio/history/${p.id}`)}
            className="block w-full text-left"
          >
            <Panel>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink">
                  {(p.editedHtml ?? p.publishedHtml).replace(/<[^>]+>/g, "").slice(0, 60)}
                  {(p.editedHtml ?? p.publishedHtml).length > 60 ? "…" : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-[11px] text-ink-faint">
                  {new Date(p.createdAt).toLocaleDateString("ru-RU")}
                </span>
                <span className="font-mono text-[11px] text-brass">{STATUS_LABEL[p.status]}</span>
              </div>
            </Panel>
          </button>
        ))}
      </div>
    </div>
  );
}
