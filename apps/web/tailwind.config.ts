import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f4f1ea",
        foreground: "#171717",
        panel: "#fffaf0",
        accent: "#16423c",
        accentSoft: "#6a9c89",
        danger: "#b23a48",
      },
      boxShadow: {
        panel: "0 18px 40px rgba(22, 66, 60, 0.12)",
      },
      fontFamily: {
        sans: ["Segoe UI", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;