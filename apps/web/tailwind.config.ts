import type { Config } from "tailwindcss";

/**
 * Every step below resolves through a CSS custom property so the same
 * class name (e.g. `bg-forest-800/60`) renders the light-theme value or
 * the dark-theme value depending on `[data-theme]`/`prefers-color-scheme`
 * — see globals.css for where `--forest-800` etc. are actually defined.
 * `<alpha-value>` is Tailwind's placeholder for its own opacity modifier
 * (the `/60` in `bg-forest-800/60`), so opacity utilities keep working.
 */
function themed(cssVar: string) {
  return `rgb(var(${cssVar}) / <alpha-value>)`;
}

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Largest surfaces: page background (950) down to the subtlest
        // divider tint (500). In dark theme these are literally forest
        // green, dark to light; in light theme the same steps become a
        // warm paper background with progressively deeper neutral chips.
        forest: {
          950: themed("--forest-950"),
          900: themed("--forest-900"),
          800: themed("--forest-800"),
          700: themed("--forest-700"),
          600: themed("--forest-600"),
          500: themed("--forest-500"),
        },
        // The one accent color, for CTAs, active states, links, success.
        mint: {
          300: themed("--mint-300"),
          400: themed("--mint-400"),
          500: themed("--mint-500"),
          600: themed("--mint-600"),
        },
        // Primary reading text (50 = headings) down to the faintest label.
        cream: {
          50: themed("--cream-50"),
          100: themed("--cream-100"),
          200: themed("--cream-200"),
          300: themed("--cream-300"),
          400: themed("--cream-400"),
          500: themed("--cream-500"),
        },
        // Text painted on top of a solid mint-400 surface (buttons, active
        // tab pills). Deliberately NOT theme-aware — mint stays roughly
        // the same brightness in both themes, so this always stays dark.
        "ink-on-accent": themed("--ink-on-accent"),
        warning: { DEFAULT: themed("--warning") },
        danger: { DEFAULT: themed("--danger") },
        info: { DEFAULT: themed("--info") },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        accent: ["var(--font-accent)", "Georgia", "serif"],
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
