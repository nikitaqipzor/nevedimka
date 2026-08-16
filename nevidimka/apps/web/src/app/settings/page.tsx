"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Eyebrow, GhostButton, Panel, PrimaryButton } from "@/components/ui";

interface SettingsResponse {
  timezone: string;
  reminderHourMorning: number | null;
  reminderHourEvening: number | null;
  programLength: number | null;
  day0Date: string | null;
  channelId: string | null;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [timezoneInput, setTimezoneInput] = useState("");
  const [morningEnabled, setMorningEnabled] = useState(false);
  const [morningHour, setMorningHour] = useState(8);
  const [eveningEnabled, setEveningEnabled] = useState(false);
  const [eveningHour, setEveningHour] = useState(21);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [channelInput, setChannelInput] = useState("");
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelMessage, setChannelMessage] = useState<string | null>(null);

  async function load() {
    const res = await apiFetch<SettingsResponse>("/api/settings");
    setData(res);
    setTimezoneInput(res.timezone);
    setMorningEnabled(res.reminderHourMorning !== null);
    setMorningHour(res.reminderHourMorning ?? 8);
    setEveningEnabled(res.reminderHourEvening !== null);
    setEveningHour(res.reminderHourEvening ?? 21);
    setChannelInput(res.channelId ?? "");
  }

  useEffect(() => {
    load();
  }, []);

  async function saveTimezone() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/settings", {
        method: "POST",
        body: JSON.stringify({ timezone: timezoneInput.trim() }),
      });
      setMessage("Часовой пояс сохранён.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  async function saveReminders() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          reminderHourMorning: morningEnabled ? morningHour : null,
          reminderHourEvening: eveningEnabled ? eveningHour : null,
        }),
      });
      setMessage("Напоминания сохранены.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  async function connectChannel() {
    setChannelBusy(true);
    setChannelError(null);
    setChannelMessage(null);
    try {
      await apiFetch("/api/settings/channel", {
        method: "POST",
        body: JSON.stringify({ channelId: channelInput.trim() }),
      });
      setChannelMessage("Канал подключён — проверь тестовое сообщение в нём.");
      await load();
    } catch (err) {
      setChannelError(err instanceof ApiError ? err.message : "Не удалось подключить канал.");
    } finally {
      setChannelBusy(false);
    }
  }

  async function deleteAccount() {
    setDeleteBusy(true);
    setError(null);
    try {
      await apiFetch("/api/settings/delete", {
        method: "POST",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      window.location.href = "/today";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить аккаунт.");
      setDeleteBusy(false);
    }
  }

  if (!data) return <div className="px-5 pt-8 text-sm text-ink-faint">Загрузка…</div>;

  return (
    <div className="px-5 pt-6 pb-6">
      <Eyebrow>Настройки</Eyebrow>

      {(message || error) && (
        <div className={`mt-3 text-xs ${error ? "text-warn" : "text-brass"}`}>{error ?? message}</div>
      )}

      <Panel className="mt-4">
        <div className="text-sm text-ink">Часовой пояс</div>
        <p className="mt-1 text-xs text-ink-faint">
          IANA-формат, например Europe/Moscow, Europe/Amsterdam, Asia/Almaty.
          Влияет на номер дня пути и на время напоминаний ниже.
        </p>
        <input
          value={timezoneInput}
          onChange={(e) => setTimezoneInput(e.target.value)}
          className="mt-2 w-full rounded-sm border border-line bg-panel-raised px-3 py-2 text-sm text-ink"
        />
        <PrimaryButton className="mt-2" disabled={busy || !timezoneInput.trim()} onClick={saveTimezone}>
          Сохранить часовой пояс
        </PrimaryButton>
      </Panel>

      <Panel className="mt-3">
        <div className="text-sm text-ink">Канал</div>
        <p className="mt-1 text-xs text-ink-faint">
          @username или численный ID канала. Бот должен быть добавлен туда администратором с правом
          публикации сообщений — это проверяется автоматически при подключении.
        </p>
        {data.channelId && (
          <div className="mt-2 text-xs text-brass">Сейчас подключён: {data.channelId}</div>
        )}
        {(channelMessage || channelError) && (
          <div className={`mt-2 text-xs ${channelError ? "text-warn" : "text-brass"}`}>
            {channelError ?? channelMessage}
          </div>
        )}
        <input
          value={channelInput}
          onChange={(e) => setChannelInput(e.target.value)}
          placeholder="@my_channel"
          className="mt-2 w-full rounded-sm border border-line bg-panel-raised px-3 py-2 text-sm text-ink"
        />
        <PrimaryButton className="mt-2" disabled={channelBusy || !channelInput.trim()} onClick={connectChannel}>
          {channelBusy ? "Проверяю…" : "Проверить и подключить"}
        </PrimaryButton>
      </Panel>

      <Panel className="mt-3">
        <div className="text-sm text-ink">Напоминания</div>
        <p className="mt-1 text-xs text-ink-faint">
          Бот сам напишет в это время по указанному выше часовому поясу. Без
          этого он не пишет первым.
        </p>

        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={morningEnabled}
              onChange={(e) => setMorningEnabled(e.target.checked)}
            />
            Утренний план
          </label>
          <select
            value={morningHour}
            disabled={!morningEnabled}
            onChange={(e) => setMorningHour(Number(e.target.value))}
            className="tabular rounded-sm border border-line bg-panel-raised px-2 py-1 text-sm text-ink disabled:opacity-40"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={eveningEnabled}
              onChange={(e) => setEveningEnabled(e.target.checked)}
            />
            Вечерний разбор
          </label>
          <select
            value={eveningHour}
            disabled={!eveningEnabled}
            onChange={(e) => setEveningHour(Number(e.target.value))}
            className="tabular rounded-sm border border-line bg-panel-raised px-2 py-1 text-sm text-ink disabled:opacity-40"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>
        </div>

        <PrimaryButton className="mt-3" disabled={busy} onClick={saveReminders}>
          Сохранить напоминания
        </PrimaryButton>
      </Panel>

      <Panel className="mt-3">
        <div className="text-sm text-ink">Путь</div>
        <div className="mt-1 text-xs text-ink-faint">
          {data.day0Date !== null && data.programLength !== null
            ? `День 0: ${data.day0Date} · длительность: ${data.programLength} дней`
            : "Нет активной цели."}
        </div>
      </Panel>

      <Panel className="mt-3">
        <div className="text-sm text-ink">Данные и приватность</div>
        <p className="mt-1 text-xs text-ink-faint">
          Все твои данные — миссия, задачи, дневник, идеи, публикации — можно
          скачать целиком или удалить безвозвратно.
        </p>
        <a
          href="/api/settings/export"
          download
          className="mt-3 block rounded-sm border border-line px-4 py-2.5 text-center text-sm text-ink-dim"
        >
          Скачать все мои данные (JSON)
        </a>

        {!showDeleteConfirm ? (
          <GhostButton className="mt-2 w-full border-warn/40 text-warn" onClick={() => setShowDeleteConfirm(true)}>
            Удалить аккаунт
          </GhostButton>
        ) : (
          <div className="mt-2 rounded-sm border border-warn/40 p-3">
            <p className="text-xs text-warn">
              Необратимо: удалит миссию, все задачи, дневник, идеи и историю
              публикаций. Напиши DELETE, чтобы подтвердить.
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-2 w-full rounded-sm border border-line bg-panel-raised px-3 py-2 text-sm text-ink"
            />
            <div className="mt-2 flex gap-2">
              <PrimaryButton
                className="bg-warn"
                disabled={deleteConfirmText !== "DELETE" || deleteBusy}
                onClick={deleteAccount}
              >
                {deleteBusy ? "Удаляю…" : "Удалить безвозвратно"}
              </PrimaryButton>
              <GhostButton
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText("");
                }}
              >
                Отмена
              </GhostButton>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
