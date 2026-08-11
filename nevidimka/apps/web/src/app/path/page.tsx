"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiClient";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

interface PathListItem {
  id: string;
  title: string;
  dayNumber: number;
  programLength: number;
}

interface PathListResponse {
  state: "no_mission" | "list";
  missions?: PathListItem[];
}

export default function PathPage() {
  const router = useRouter();
  const [data, setData] = useState<PathListResponse | null>(null);

  useEffect(() => {
    apiFetch<PathListResponse>("/api/path").then(setData);
  }, []);

  if (!data) return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;

  if (data.state === "no_mission") {
    return (
      <div className="px-5 pt-8">
        <Eyebrow>Путь</Eyebrow>
        <div className="mt-6">
          <EmptyState title="Миссия ещё не запущена" hint="Заверши онбординг в боте — /start." />
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Путь</Eyebrow>

      <div className="mt-4 space-y-2">
        {(data.missions ?? []).map((m) => {
          const pct = Math.max(0, Math.min(100, Math.round((m.dayNumber / m.programLength) * 100)));
          return (
            <button
              key={m.id}
              onClick={() => router.push(`/path/${m.id}`)}
              className="block w-full text-left"
            >
              <Panel>
                <div className="text-sm text-ink">{m.title}</div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-ink-faint">
                    день {m.dayNumber} / {m.programLength}
                  </span>
                  <span className="font-mono text-[11px] text-brass">{pct}%</span>
                </div>
                <div className="mt-1.5 h-px w-full bg-line">
                  <div
                    className="h-px bg-brass transition-[width] duration-700 ease-out motion-reduce:transition-none"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Panel>
            </button>
          );
        })}
      </div>
    </div>
  );
}
