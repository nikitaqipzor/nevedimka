import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockTelegramCall {
  method: string;
  payload: Record<string, unknown>;
}

export function startMockTelegram(): Promise<{
  url: string;
  calls: MockTelegramCall[];
  close: () => Promise<void>;
}> {
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
        // multipart/form-data (sendDocument, sendVideo) isn't JSON — the
        // mock doesn't need to parse it, just needs to respond OK.
        payload = {};
      }
      calls.push({ method, payload });
      res.setHeader("Content-Type", "application/json");
      if (method === "sendMessage" || method === "sendVideo" || method === "sendDocument") {
        res.end(JSON.stringify({ ok: true, result: { message_id: calls.length, text: payload.text } }));
      } else if (method === "getMe") {
        res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "Test", username: "test_bot" } }));
      } else {
        res.end(JSON.stringify({ ok: true, result: true }));
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

/** Returns the text of the most recent sendMessage call — what the bot "said" last. */
export function lastBotReply(calls: MockTelegramCall[]): string | undefined {
  const sent = calls.filter((c) => c.method === "sendMessage");
  return sent.length ? (sent[sent.length - 1].payload.text as string) : undefined;
}
