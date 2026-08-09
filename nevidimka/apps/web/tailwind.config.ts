import type { Config } from "tailwindcss";

/**
 * Design tokens for "Невидимка" — a private daily-discipline log, not a
 * marketing surface. Deliberately avoiding the templated warm-cream/serif
 * and near-black/acid-accent defaults: this reads as a quiet operational
 * instrument (mission log / field terminal), fixed-dark regardless of the
 * host Telegram theme, with one restrained brass accent doing all the work.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#111316", // page background
        panel: "#191c20", // card/panel surface
        "panel-raised": "#20242a", // hover/active surface
        line: "#2a2e35", // hairline borders
        ink: "#E9E6DE", // primary text (warm off-white, not pure white)
        "ink-dim": "#8B909A", // secondary text
        "ink-faint": "#565B64", // tertiary / placeholder
        brass: "#C9A227", // single accent: progress, active states, focus
        "brass-dim": "#8A7220",
        slate: "#5B7C99", // cool secondary accent: informational tags
        done: "#5C8A66", // completion state (desaturated green, not neon)
        warn: "#B4643A", // postponed/attention (desaturated clay, not alarm-red)
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SF Mono",
          "Cascadia Code",
          "Roboto Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "10px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset",
      },
    },
  },
  plugins: [],
};

export default config;
