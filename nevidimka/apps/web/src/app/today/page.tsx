"use client";

import Link from "next/link";

import { useState } from "react";
import type { Task } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { useLoad } from "@/lib/useLoad";
import { DayGauge } from "@/components/DayGauge";
import { CheckInForm } from "@/components/CheckInForm";
import { TaskCard } from "@/components/TaskCard";
import { EmptyState, Eyebrow, LoadState, Panel, PrimaryButton } from "@/components/ui";

interface TodayResponse {
  state: "no_mission" | "needs_checkin" | "no_plan_yet" | "ready";
  dayNumber?: number;
  programLength?: number;
  missionTitle?: string;
  userFirstName?: string;
  plan?: {
    id: string;
    aiSummary?: string;
    checkIn?: { sleepQuality?: number; energy?: number; mood?: number; stress?: number };
  };
  tasks?: Task[];
}

export default function TodayPage() {
  const [busy, setBusy] = useState(false);
  const {
    data,
    state: loadState,
    error: loadError,
    reload: load,
  } = useLoad<TodayResponse>(() => apiFetch<TodayResponse>("/api/today"));

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

  // Loading, offline, and error all render here; only a successful load
  // falls through to the screen itself. `data` can still be null on an
  // error after a previous success, so the guard stays.
  if (loadState !== "ready" || !data) {
    return <LoadState state={loadState} error={loadError} onRetry={load} />;
  }

  if (data.state === "no_mission") {
    return (
      <div className="px-5 pt-8">
        <Eyebrow>Невидимка</Eyebrow>
        <div className="mt-6">
          <EmptyState
            title="Миссия ещё не запущена"
            hint="Можно начать прямо здесь — или командой /start в боте."
          />
          <Link href="/onboarding" className="mt-4 block">
            <PrimaryButton className="w-full">Начать путь</PrimaryButton>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6">
      <DayGauge
        dayNumber={data.dayNumber ?? 0}
        programLength={data.programLength ?? 1}
        label={data.missionTitle}
      />

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
              <TaskCard key={task.id} task={task} onChanged={load} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
