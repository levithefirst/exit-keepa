import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep forest green — page background, nav, footer, large surfaces.
        forest: {
          950: "#081711",
          900: "#0c2018",
          800: "#12291f",
          700: "#1a3729",
          600: "#254936",
          500: "#356149",
        },
        // Bright mint/lime — the one accent color for CTAs, active states, success.
        mint: {
          300: "#c9f7a8",
          400: "#a3ee6e",
          500: "#8ade51",
          600: "#6cbd3a",
        },
        // Warm cream — primary typography on dark surfaces, light surfaces.
        cream: {
          50: "#faf7ee",
          100: "#f2ead4",
          200: "#e4d8b8",
          300: "#cfc09a",
          400: "#a89b7a",
        },
        // Legacy aliases kept so existing utility classes (bg-ink, bg-accent,
        // text-accent, etc.) still resolve while every screen migrates.
        ink: "#081711",
        accent: {
          DEFAULT: "#a3ee6e",
          dim: "#6cbd3a",
        },
        warning: { DEFAULT: "#e8b95e", soft: "rgba(232,185,94,0.12)" },
        danger: { DEFAULT: "#e8846a", soft: "rgba(232,132,106,0.12)" },
        info: { DEFAULT: "#8ec8e8", soft: "rgba(142,200,232,0.12)" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.625rem",
        lg: "0.875rem",
        xl: "1.25rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
