import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Base surfaces — a restrained three-step elevation scale rather
        // than one flat background, so cards read as "raised" using fill +
        // border instead of drop shadows (shadows barely register on a
        // dark canvas).
        ink: "#0b0f17",
        surface: "#111826",
        "surface-raised": "#161f30",
        // Semantic accent — reserved for primary actions and "healthy /
        // active" states only, never decorative.
        accent: {
          DEFAULT: "#22c55e",
          dim: "#16a34a",
          soft: "rgba(34, 197, 94, 0.12)",
        },
        warning: {
          DEFAULT: "#f59e0b",
          soft: "rgba(245, 158, 11, 0.12)",
        },
        danger: {
          DEFAULT: "#f87171",
          soft: "rgba(248, 113, 113, 0.12)",
        },
        info: {
          DEFAULT: "#60a5fa",
          soft: "rgba(96, 165, 250, 0.12)",
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
