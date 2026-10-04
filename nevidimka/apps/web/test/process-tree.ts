import { spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Only accepts servers spawned with detached:true on POSIX (their own group). */
export async function stopServerTree(server: ChildProcess | undefined): Promise<void> {
  if (!server?.pid) return;
  const pid = server.pid;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    if (result.error) throw result.error;
  } else {
    // next dev forks next-server; killing only the CLI leaves the server,
    // its inherited pipes and Postgres connections alive.
    try { process.kill(-pid, "SIGTERM"); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err; }
    await delay(300);
    try { process.kill(-pid, "SIGKILL"); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err; }
  }
  if (server.exitCode === null && server.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Test server failed to exit")), 5000);
      server.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  server.stdout?.destroy();
  server.stderr?.destroy();
}
