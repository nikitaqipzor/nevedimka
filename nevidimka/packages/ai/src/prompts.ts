import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Works both from src (tsx dev) and dist (compiled): the prompts/ folder is
// always a direct sibling of the package root, one level up from either.
const PROMPTS_DIR = join(__dirname, "..", "prompts");

const cache = new Map<string, string>();

export function loadPrompt(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const text = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
  cache.set(name, text);
  return text;
}
