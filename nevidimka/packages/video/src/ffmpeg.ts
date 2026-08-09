import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — generous for the 180s duration cap

/**
 * Runs an external command (ffmpeg/ffprobe) and collects its output.
 * ffmpeg writes almost everything — including data we need to parse, like
 * silencedetect — to stderr, not stdout, so both are always captured.
 *
 * Enforces a timeout: apps/worker processes jobs sequentially, one at a
 * time, so a single hung ffmpeg invocation (malformed input, resource
 * exhaustion) would otherwise stall every user's video processing
 * indefinitely, not just the job that's actually stuck.
 */
export function runCommand(
  cmd: string,
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${timeoutMs}ms and was killed`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-2000)}`));
      }
    });
  });
}

export function runFfmpeg(args: string[]): Promise<RunResult> {
  // -y: overwrite output without prompting (this runs unattended in a worker)
  // -hide_banner -loglevel: keep stderr readable for our own parsing needs
  return runCommand("ffmpeg", ["-y", "-hide_banner", ...args]);
}

export function runFfprobe(args: string[]): Promise<RunResult> {
  return runCommand("ffprobe", args);
}
