"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "@nevidimka/shared-types";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Eyebrow, GhostButton, Panel } from "@/components/ui";

const PERIODS = [
  { days: 7, label: "неделя" },
  { days: 30, label: "месяц" },
  { days: 180, label: "путь" },
] as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tabular font-mono text-2xl text-ink">{value}</div>
      <div className="mt-0.5 text-xs text-ink-faint">{label}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<7 | 30 | 180>(7);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [observations, setObservations] = useState<string[] | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setObservations(null);
    setInsightError(null);
    apiFetch<{ summary: AnalyticsSummary }>(`/api/analytics?days=${days}`).then((res) =>
      setSummary(res.summary)
    );
  }, [days]);

  async function askForInsight() {
    setInsightBusy(true);
    setInsightError(null);
    try {
      const res = await apiFetch<{ observations: string[] }>("/api/analytics/insights", {
        method: "POST",
        body: JSON.stringify({ days }),
      });
      setObservations(res.observations);
    } catch (err) {
      setInsightError(err instanceof ApiError ? err.message : "Не удалось получить наблюдение.");
    } finally {
      setInsightBusy(false);
    }
  }

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Аналитика</Eyebrow>

      <div className="mt-4 flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`rounded-sm border px-3 py-1.5 text-xs ${
              days === p.days ? "border-brass text-brass" : "border-line text-ink-faint"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!summary ? (
        <div className="mt-6 text-sm text-ink-faint">Загрузка…</div>
      ) : (
        <div className="mt-6 space-y-3">
          <Panel className="grid grid-cols-2 gap-4">
            <Stat label="выполнение плана" value={`${summary.completionRate}%`} />
            <Stat label="задач сделано" value={`${summary.tasksDone} / ${summary.tasksPlanned}`} />
            <Stat label="перенесено" value={String(summary.postponedCount)} />
            <Stat
              label="фокус-время"
              value={`${Math.floor(summary.focusMinutesTotal / 60)}ч ${summary.focusMinutesTotal % 60}м`}
            />
          </Panel>

          <Panel>
            <Eyebrow>Самочувствие (среднее)</Eyebrow>
            <div className="mt-3 grid grid-cols-4 gap-3">
              <Stat label="сон" value={summary.averageSleep?.toFixed(1) ?? "—"} />
              <Stat label="энергия" value={summary.averageEnergy?.toFixed(1) ?? "—"} />
              <Stat label="настроение" value={summary.averageMood?.toFixed(1) ?? "—"} />
              <Stat label="стресс" value={summary.averageStress?.toFixed(1) ?? "—"} />
            </div>
          </Panel>

          <Panel>
            <Eyebrow>Что заметил AI-наставник</Eyebrow>
            {observations === null ? (
              <>
                <p className="mt-2 text-xs text-ink-faint">
                  Числа выше считает код. Это — просьба к AI объяснить, что в них есть, не придумывая
                  новых фактов.
                </p>
                <GhostButton className="mt-3" disabled={insightBusy} onClick={askForInsight}>
                  {insightBusy ? "Смотрю…" : "Что ты заметил?"}
                </GhostButton>
                {insightError && <div className="mt-2 text-xs text-warn">{insightError}</div>}
              </>
            ) : observations.length === 0 ? (
              <p className="mt-2 text-sm text-ink-dim">
                Пока недостаточно данных для содержательного наблюдения.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {observations.map((o, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink">
                    • {o}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
