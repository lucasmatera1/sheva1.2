import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: "#08110e",
        pine: "#0f2a22",
        moss: "#214438",
        sage: "#89a88d",
        sand: "#ede4d1",
        ivory: "#f8f2e6",
        gold: "#d7b26d",
        coral: "#f08d74",
        mist: "#b6cbbf",
      },
      boxShadow: {
        panel: "0 28px 90px rgba(5, 16, 13, 0.24)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
      },
      backgroundImage: {
        mesh:
          "radial-gradient(circle at top left, rgba(240, 141, 116, 0.18), transparent 34%), radial-gradient(circle at top right, rgba(215, 178, 109, 0.18), transparent 26%), linear-gradient(180deg, rgba(8, 17, 14, 1), rgba(9, 25, 20, 0.96))",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-body)", "sans-serif"],
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -10px, 0)" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
