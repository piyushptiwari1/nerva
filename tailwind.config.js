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
          800: "#15181e",
          700: "#1c2028",
          600: "#262b35",
          500: "#3a414f",
          400: "#5b6473",
          300: "#8a93a3",
          200: "#b9c0cc",
          100: "#e3e6ec",
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
