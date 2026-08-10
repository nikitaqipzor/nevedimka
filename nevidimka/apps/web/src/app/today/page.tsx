"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { DayGauge } from "@/components/DayGauge";
import { CheckInForm } from "@/components/CheckInForm";
import { TaskCard } from "@/components/TaskCard";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

interface TodayMission {
  id: string;
  title: string;
  dayNumber: number;
  programLength: number;
}

interface TodayResponse {
  state: "no_mission" | "needs_checkin" | "no_plan_yet" | "ready";
  userFirstName?: string;
  missions?: TodayMission[];
  plan?: {
    id: string;
    aiSummary?: string;
    checkIn?: { sleepQuality?: number; energy?: number; mood?: number; stress?: number };
  };
  tasks?: Task[];
}

export default function TodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<TodayResponse>("/api/today");
    setData(res);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitCheckIn(values: {
    sleepQuality: number;
    energy: number;
    mood: number;
    stress: number;
  }) {
    setBusy(true);
    try {
      await apiFetch("/api/today", {
        method: "POST",
        body: JSON.stringify({ action: "checkin", ...values }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;
  }

  if (data.state === "no_mission") {
    return (
      <div className="px-5 pt-8">
        <Eyebrow>Невидимка</Eyebrow>
        <div className="mt-6">
          <EmptyState
            title="Миссия ещё не запущена"
            hint="Заверши онбординг в боте — команда /start."
          />
        </div>
      </div>
    );
  }

  const missionById = new Map((data.missions ?? []).map((m) => [m.id, m]));

  return (
    <div className="px-5 pt-6">
      <div className="space-y-5">
        {(data.missions ?? []).map((m) => (
          <DayGauge key={m.id} dayNumber={m.dayNumber} programLength={m.programLength} label={m.title} />
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {data.state === "needs_checkin" && (
          <CheckInForm onSubmit={submitCheckIn} busy={busy} />
        )}

        {data.state === "no_plan_yet" && data.plan?.checkIn && (
          <Panel>
            <div className="text-sm text-ink-dim">
              Чек-ин записан, план ещё не сформирован.
            </div>
            <button
              className="mt-3 text-sm text-brass underline underline-offset-2"
              disabled={busy}
              onClick={() =>
                submitCheckIn({
                  sleepQuality: data.plan!.checkIn!.sleepQuality ?? 3,
                  energy: data.plan!.checkIn!.energy ?? 3,
                  mood: data.plan!.checkIn!.mood ?? 3,
                  stress: data.plan!.checkIn!.stress ?? 3,
                })
              }
            >
              Сформировать план
            </button>
          </Panel>
        )}

        {data.state === "ready" && (
          <>
            {data.plan?.aiSummary && (
              <Panel>
                <p className="text-sm leading-relaxed text-ink">{data.plan.aiSummary}</p>
              </Panel>
            )}
            {(data.tasks ?? []).map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                missionTitle={task.missionId ? missionById.get(task.missionId)?.title : undefined}
                onChanged={load}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
