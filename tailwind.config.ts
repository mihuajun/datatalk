import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#4f6ef7",
        ink: "#141a2a",
        muted: "#667085",
        line: "#e4e7ec",
        surface: "#f8fafc",
        success: "#12b76a",
        warning: "#f79009",
      },
      boxShadow: {
        panel: "0 18px 60px rgba(15, 23, 42, 0.08)",
      },
      backgroundImage: {
        hero: "radial-gradient(circle at top left, rgba(79,110,247,0.18), transparent 32%), radial-gradient(circle at 85% 10%, rgba(18,183,106,0.14), transparent 25%)",
      },
    },
  },
  plugins: [],
};

export default config;
