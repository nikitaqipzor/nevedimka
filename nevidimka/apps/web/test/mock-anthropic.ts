import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal mock of the Anthropic Messages API. Inspects the system prompt
 * to detect which AI role is being called (each prompts/*.md file has a
 * distinct opening line) and returns a canned JSON response shaped to
 * match that role's zod schema — so tests exercise the full request →
 * response → parse → render path, not just "was a call made".
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
    if (system.includes("режиме свободного диалога") || system.includes("AI-наставник")) {
      return { reply: "Хороший вопрос. Судя по последним дням, темп стабильный — продолжай так же." };
    }
    if (system.includes("наставник действий")) {
      return {
        first_step: "Открыть файл и начать с самого простого случая",
        subtasks: ["Написать черновик", "Проверить на примере"],
        note: null,
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
      return {
        plans: missionIds.map((missionId, i) => ({
          mission_id: missionId,
          summary: `Тестовый план дня ${i + 1}.`,
          main_task: { title: `Тестовая задача ${i + 1}`, estimate_minutes: 30, direction: null },
          reasoning_note: "test",
        })),
      };
    }
    if (system.includes("аналитик поведения")) {
      return { observations: ["Темп выполнения стабильный уже вторую неделю подряд."] };
    }
    if (system.includes("наставник по развитию навыков")) {
      return { guidance: [{ direction: "Создание", note: "Хороший темп — стоит поддерживать регулярность." }] };
    }
    if (system.includes("редактор текста")) {
      return {
        gentle: "Сегодня настроил окружение проекта. Один маленький, но настоящий шаг.",
        structured: "Итог дня:\n\nНастроил окружение проекта — небольшой, но реальный прогресс.",
        short: "Настроил окружение проекта.",
      };
    }
    return { reply: "ок" };
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body);
      const outputObj = pickResponse(payload);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: payload.model,
          content: [{ type: "text", text: JSON.stringify(outputObj) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 50, output_tokens: 30 },
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
