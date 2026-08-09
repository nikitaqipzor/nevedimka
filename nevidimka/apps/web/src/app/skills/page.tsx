"use client";

import { useEffect, useState } from "react";
import type { SkillProgress } from "@nevidimka/shared-types";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { EmptyState, Eyebrow, GhostButton, Panel } from "@/components/ui";

interface Guidance {
  direction: string;
  note: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillProgress[] | null>(null);
  const [guidance, setGuidance] = useState<Guidance[] | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ skills: SkillProgress[] }>("/api/skills").then((res) => setSkills(res.skills));
  }, []);

  async function askForGuidance() {
    setInsightBusy(true);
    setInsightError(null);
    try {
      const res = await apiFetch<{ guidance: Guidance[] }>("/api/skills/insights", { method: "POST" });
      setGuidance(res.guidance);
    } catch (err) {
      setInsightError(err instanceof ApiError ? err.message : "Не удалось получить рекомендацию.");
    } finally {
      setInsightBusy(false);
    }
  }

  return (
    <div className="px-5 pt-6">
      <Eyebrow>Карта навыков</Eyebrow>

      <div className="mt-4 space-y-3">
        {skills === null && <div className="text-sm text-ink-faint">Загрузка…</div>}
        {skills?.length === 0 && (
          <EmptyState title="Направлений пока нет" hint="Появятся из активной миссии." />
        )}
        {skills?.map((s) => (
          <Panel key={s.direction}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink">{s.direction}</span>
              <span className="tabular font-mono text-sm text-brass">{s.completionPercent}%</span>
            </div>
            <div className="mt-2 h-px w-full bg-line">
              <div
                className="h-px bg-brass transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${s.completionPercent}%` }}
              />
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-ink-faint">
              {s.doneTasks} / {s.totalTasks} задач
            </div>
          </Panel>
        ))}

        {skills && skills.length > 0 && (
          <Panel>
            <Eyebrow>Наставник по навыкам</Eyebrow>
            {guidance === null ? (
              <>
                <p className="mt-2 text-xs text-ink-faint">
                  Просьба к AI посмотреть на баланс между направлениями и подсказать, куда стоит
                  перераспределить внимание.
                </p>
                <GhostButton className="mt-3" disabled={insightBusy} onClick={askForGuidance}>
                  {insightBusy ? "Смотрю…" : "Как баланс между направлениями?"}
                </GhostButton>
                {insightError && <div className="mt-2 text-xs text-warn">{insightError}</div>}
              </>
            ) : guidance.length === 0 ? (
              <p className="mt-2 text-sm text-ink-dim">
                Пока недостаточно завершённых задач для содержательной рекомендации.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {guidance.map((g, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink">
                    <span className="text-brass">{g.direction}:</span> {g.note}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
