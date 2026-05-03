import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-space)", "system-ui", "sans-serif"],
        serif: ["var(--font-playfair)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "Menlo", "monospace"],
      },
      colors: {
        surface: "#0a0a0a",
        "surface-2": "#111111",
      },
      boxShadow: {
        "cyan-glow": "0 0 28px rgba(34,211,238,0.12)",
        "cyan-ring": "0 0 0 1px rgba(34,211,238,0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
