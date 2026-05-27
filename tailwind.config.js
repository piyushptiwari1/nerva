/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // matte dark palette
        ink: {
          950: "#0a0b0d",
          900: "#0f1115",
          800: "#161a21",
          700: "#1f242e",
          600: "#2c323d",
          500: "#4a5260",
          400: "#7a8494",
          300: "#a7afbe",
          200: "#cbd1dc",
          100: "#ecf0f6",
        },
        accent: {
          DEFAULT: "#7c9cff",
          deep: "#5a7ce0",
          glow: "#a8bdff",
        },
        focus: "#e8b86d",
        rest: "#7dd6a8",
        danger: "#e87d7d",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 0 0 rgba(0,0,0,0.4)",
        glow: "0 0 24px -8px rgba(124,156,255,0.4)",
      },
      backdropBlur: { xs: "2px" },
    },
  },
  plugins: [],
};
