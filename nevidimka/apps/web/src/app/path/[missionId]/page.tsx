"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { MilestoneView } from "@nevidimka/shared-types";
import { ApiError, apiFetch } from "@/lib/apiClient";
import { DayGauge } from "@/components/DayGauge";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

interface PathDetailResponse {
  state: "ready";
  mission: { title: string; description?: string; directions: string[]; commitmentText: string };
  dayNumber: number;
  programLength: number;
  milestones: MilestoneView[];
}

const STATUS_DOT: Record<MilestoneView["status"], string> = {
  current: "bg-brass",
  passed: "bg-ink-faint",
  done: "bg-done",
  planned: "bg-line",
  in_progress: "bg-brass",
  skipped: "bg-ink-faint",
};

export default function PathDetailPage() {
  const params = useParams<{ missionId: string }>();
  const router = useRouter();
  const [data, setData] = useState<PathDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setData(null);
    setNotFound(false);
    apiFetch<PathDetailResponse>(`/api/path?missionId=${params.missionId}`)
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        throw err;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.missionId]);

  if (notFound) {
    return (
      <div className="px-5 pt-8">
        <Eyebrow>Путь</Eyebrow>
        <div className="mt-6">
          <EmptyState title="Цель не найдена" hint="Вернись к списку целей." />
        </div>
      </div>
    );
  }

  if (!data) return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;

  return (
    <div className="px-5 pt-6">
      <button
        onClick={() => router.push("/path")}
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint"
      >
        ← Путь
      </button>

      <div className="mt-3">
        <DayGauge dayNumber={data.dayNumber} programLength={data.programLength} />
      </div>

      <Panel className="mt-6">
        <div className="text-base text-ink">{data.mission.title}</div>
        {data.mission.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{data.mission.description}</p>
        )}
        {!!data.mission.directions.length && (
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

      <Panel className="mt-3">
        <Eyebrow>Договор с собой</Eyebrow>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-dim">
          {data.mission.commitmentText}
        </p>
      </Panel>

      <div className="mt-6">
        <Eyebrow>Этапы</Eyebrow>
        <div className="relative mt-3 space-y-4 border-l border-line pl-4">
          {data.milestones.map((m) => (
            <div key={m.id} className="relative">
              <span
                className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ${STATUS_DOT[m.status]}`}
              />
              <div className="font-mono text-[11px] text-ink-faint">день {m.targetDay}</div>
              <div className="text-sm text-ink">{m.title}</div>
            </div>
          ))}
          {!data.milestones.length && (
            <div className="text-sm text-ink-faint">Этапы не заданы.</div>
          )}
        </div>
      </div>
    </div>
  );
}
