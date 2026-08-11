/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        surface: {
          950: "#0a0e14",
          900: "#0f1420",
          800: "#161d2b",
          700: "#232c3f",
          600: "#334158",
        },
        accent: {
          400: "#5eead4",
          500: "#2dd4bf",
          600: "#14b8a6",
        },
      },
    },
  },
  plugins: [],
};
