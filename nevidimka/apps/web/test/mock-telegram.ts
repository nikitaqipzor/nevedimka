import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockTelegramCall {
  method: string;
  payload: Record<string, unknown>;
}

export function startMockTelegram(): Promise<{ url: string; calls: MockTelegramCall[]; close: () => Promise<void> }> {
  const calls: MockTelegramCall[] = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const method = req.url?.split("/").pop() ?? "";
      let payload: Record<string, unknown> = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        payload = {};
      }
      calls.push({ method, payload });
      res.setHeader("Content-Type", "application/json");
      if (method === "getMe") {
        res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "Test", username: "test_bot" } }));
      } else if (method === "getChatMember") {
        res.end(JSON.stringify({ ok: true, result: { status: "administrator", can_post_messages: true } }));
      } else {
        res.end(JSON.stringify({ ok: true, result: { message_id: 9001 } }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}`,
        calls,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
