"use client";

import { useState } from "react";
import { Eyebrow, Panel, PrimaryButton } from "./ui";

const FIELDS = [
  { key: "sleepQuality", label: "Сон" },
  { key: "energy", label: "Энергия" },
  { key: "mood", label: "Настроение" },
  { key: "stress", label: "Стресс" },
] as const;

type CheckInValues = Record<(typeof FIELDS)[number]["key"], number>;

export function CheckInForm({
  onSubmit,
  busy,
}: {
  onSubmit: (values: CheckInValues) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState<CheckInValues>({
    sleepQuality: 3,
    energy: 3,
    mood: 3,
    stress: 3,
  });

  return (
    <Panel>
      <Eyebrow>Чек-ин</Eyebrow>
      <div className="mt-3 space-y-4">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm text-ink">{label}</span>
              <span className="tabular font-mono text-sm text-brass">{values[key]}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
              className="w-full accent-[#C9A227]"
            />
          </div>
        ))}
      </div>
      <PrimaryButton className="mt-4 w-full" disabled={busy} onClick={() => onSubmit(values)}>
        {busy ? "Собираю план…" : "Отправить"}
      </PrimaryButton>
    </Panel>
  );
}
