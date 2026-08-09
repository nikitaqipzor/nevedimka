"use client";

import { useEffect, useRef, useState } from "react";
import type { MentorMessage } from "@nevidimka/shared-types";
import { apiFetch } from "@/lib/apiClient";
import { Eyebrow, PrimaryButton } from "@/components/ui";

export default function MentorPage() {
  const [messages, setMessages] = useState<MentorMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ messages: MentorMessage[] }>("/api/mentor").then((res) => setMessages(res.messages));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, userId: "", role: "user", content: text, createdAt: new Date().toISOString() },
    ]);
    setBusy(true);
    try {
      const res = await apiFetch<{ reply: MentorMessage }>("/api/mentor", {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setMessages((m) => [...m, res.reply]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-dvh flex-col px-5 pt-6">
      <Eyebrow>AI-наставник</Eyebrow>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pb-4">
        {!messages.length && (
          <div className="text-sm text-ink-faint">
            Спроси про сегодняшний план, застревание на задаче или общий прогресс.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-md px-3 py-2 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-auto bg-panel-raised text-ink"
                : "border border-line bg-panel text-ink"
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-line pb-4 pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Сообщение…"
          className="flex-1 rounded-sm border border-line bg-panel-raised px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint"
        />
        <PrimaryButton disabled={busy} onClick={send}>
          →
        </PrimaryButton>
      </div>
    </div>
  );
}
