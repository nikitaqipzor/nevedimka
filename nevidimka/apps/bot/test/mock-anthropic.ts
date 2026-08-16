import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal mock of the Anthropic Messages API. Inspects the system prompt
 * to detect which AI role is being called (each prompts/*.md file has a
 * distinct opening line) and returns a canned JSON response shaped to
 * match that role's zod schema.
 */
export function startMockAnthropic(): Promise<{ url: string; close: () => Promise<void> }> {
  // Takes the whole request payload (not just `system`) because the day
  // planner branch below needs to read the caller's `missions` array out of
  // the user message to echo back a matching `mission_id` per plan — the
  // MultiMissionDayPlannerOutputSchema's refine() rejects any mission_id
  // that wasn't in the request, and the route silently skips (and doesn't
  // create a task for) any mission_id it doesn't recognize.
  function pickResponse(payload: { system?: string; messages?: Array<{ content?: unknown }> }): unknown {
    const system = payload.system ?? "";
    if (system.includes("наставник действий")) {
      return {
        first_step: "Открыть файл и написать первую функцию",
        subtasks: ["Набросать структуру", "Написать тесты"],
        note: "Не пытайся сделать идеально с первого раза",
      };
    }
    if (system.includes("планировщик дня")) {
      // planDay (single-mission) was removed — planDayForMissions is the
      // only caller left, so this always returns the multi-mission
      // `{ plans: [...] }` shape, one entry per mission in the request.
      let missionIds: string[] = [];
      try {
        const rawContent = payload.messages?.[0]?.content;
        const input = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
        if (input && Array.isArray(input.missions)) {
          missionIds = input.missions.map((m: { missionId: string }) => m.missionId);
        }
      } catch {
        // fall through with an empty list — an empty `plans` array will
        // fail MultiMissionDayPlannerOutputSchema's min(1), surfacing as a
        // clear parse error rather than silently misbehaving.
      }
      // Deliberately the same fixed content for every mission (not indexed
      // by position) — this preserves the exact main_task title/direction
      // the pre-existing single-mission /today test in full-flow.test.ts
      // asserts on, and callers that need to tell two missions' plans apart
      // in a test do so via mission_id (which IS distinct per plan), not by
      // scraping title text.
      return {
        plans: missionIds.map((missionId) => ({
          mission_id: missionId,
          summary: "Никита, день 1 из 180. Сегодня закладываем основу. Главная задача — начать проект.",
          main_task: { title: "Настроить окружение проекта", estimate_minutes: 45, direction: "Создание" },
          reasoning_note: "Начинаем мягко, чтобы не перегореть в первый день.",
        })),
      };
    }
    if (system.includes("режиме свободного диалога") || system.includes("AI-наставник")) {
      return { reply: "Понял. Главная задача сегодня — настроить окружение. Начни с малого шага." };
    }
    if (system.includes("контролёр приватности")) {
      return { flags: [] };
    }
    if (system.includes("ревьюер результата")) {
      return { completion_percent: 80, comment: "Хороший прогресс, основа заложена.", needs_clarification: false };
    }
    if (system.includes("стратег в системе")) {
      return {
        title: "Запустить личный проект дисциплины",
        description: "180-дневный путь построения продукта и здоровых привычек.",
        milestones: [
          { title: "MVP готов", target_day: 30 },
          { title: "Первые пользователи", target_day: 90 },
        ],
      };
    }
    if (system.includes("редактор текста")) {
      return {
        gentle: "Сегодня настроил окружение проекта. Один маленький, но настоящий шаг.",
        structured: "Итог дня:\n\nНастроил окружение проекта — небольшой, но реальный прогресс.",
        short: "Настроил окружение проекта.",
      };
    }
    throw new Error("mock-anthropic: unrecognized role system prompt: " + system.slice(0, 80));
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body);
      let outputObj: unknown;
      try {
        outputObj = pickResponse(payload);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ type: "error", error: { message: (err as Error).message } }));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: payload.model,
          content: [{ type: "text", text: JSON.stringify(outputObj) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 123, output_tokens: 45 },
        })
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
