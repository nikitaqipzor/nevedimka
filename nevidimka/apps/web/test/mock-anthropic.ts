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
  function pickResponse(system: string): unknown {
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
      return {
        summary: "Тестовый план дня.",
        main_task: { title: "Тестовая задача", estimate_minutes: 30, direction: null },
        additional_tasks: [],
        reasoning_note: "test",
      };
    }
    if (system.includes("аналитик поведения")) {
      return { observations: ["Темп выполнения стабильный уже вторую неделю подряд."] };
    }
    if (system.includes("стратег")) {
      // Onboarding from the web (/api/path draft_mission) calls this role.
      return {
        title: "Запустить продукт и довести до дохода",
        description: "180 дней на один продукт, без распыления.",
        milestones: [
          { title: "Рабочая первая версия", target_day: 30 },
          { title: "Первые пользователи", target_day: 90 },
        ],
      };
    }
    if (system.includes("наставник по развитию навыков")) {
      return { guidance: [{ direction: "Создание", note: "Хороший темп — стоит поддерживать регулярность." }] };
    }
    return { reply: "ок" };
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body);
      const outputObj = pickResponse(payload.system ?? "");
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
