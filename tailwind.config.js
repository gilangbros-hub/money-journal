/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.hbs",
    "./views/partials/**/*.hbs",
    "./public/js/**/*.js",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#1f4f92",
          dark: "#183f75",
          deep: "#163a6f",
          subtle: "rgba(31,79,146,0.14)",
        },
        bg: {
          DEFAULT: "#e5ddcd",
          secondary: "#f6f1e7",
          tertiary: "#efe7d8",
          overlay: "rgba(18, 25, 43, 0.45)",
        },
        text: {
          primary: "#17213a",
          secondary: "#4a5473",
          muted: "#7d879e",
          inverse: "#ffffff",
        },
        border: {
          DEFAULT: "#d3c8b5",
          light: "#d3c8b5",
          subtle: "#ece3d4",
        },
        semantic: {
          success: {
            DEFAULT: "#1f4f92",
            bg: "rgba(31,79,146,0.12)",
            text: "#163a6f"
          },
          neutral: {
            bg: "rgba(23,33,58,0.08)",
            text: "#35405b"
          },
          danger: {
            DEFAULT: "#f44028",
            bg: "#fde3dc",
            text: "#b83422"
          }
        },
        // We set legacy token names pointing to standard gray to prevent crash before full refactor
        coral: { DEFAULT: "#f44028", light: "#fde3dc", dark: "#b83422", glow: "#fde3dc" },
        lime: { DEFAULT: "#1f4f92", light: "#d7e3f6", dark: "#163a6f", glow: "#d7e3f6" },
        cyan: { DEFAULT: "#1f4f92", light: "#d7e3f6", dark: "#163a6f", glow: "#d7e3f6" },
        amber: { DEFAULT: "#f8b11b", light: "#fdf0cc", dark: "#b68011", glow: "#fdf0cc" },
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, #1f4f92 0%, #183f75 100%)",
        "gradient-primary": "linear-gradient(135deg, #1f4f92 0%, #183f75 100%)",
        "gradient-danger": "linear-gradient(135deg, #f44028 0%, #b83422 100%)",
        "gradient-success": "linear-gradient(135deg, #1f4f92 0%, #163a6f 100%)",
        "gradient-card": "linear-gradient(135deg, #f6f1e7 0%, #efe7d8 100%)",
        "gradient-cta": "linear-gradient(135deg, #7b3cf1 0%, #5a21d1 100%)",
      },
      borderRadius: {
        "xl": "12px",
        "2xl": "16px",
        "3xl": "16px",
        "4xl": "24px",
      },
      boxShadow: {
        "glow-primary": "rgba(0,0,0,0.03) 0px 4px 24px",
        "glow-coral": "rgba(0,0,0,0.03) 0px 4px 24px",
        "glow-lime": "rgba(0,0,0,0.03) 0px 4px 24px",
        "glow-cyan": "rgba(0,0,0,0.03) 0px 4px 24px",
        "glow-amber": "rgba(0,0,0,0.03) 0px 4px 24px",
        "card": "rgba(0,0,0,0.03) 0px 4px 24px",
        "card-hover": "rgba(0,0,0,0.06) 0px 6px 28px",
        "subtle": "rgba(0,0,0,0.03) 0px 4px 24px",
        "micro": "rgba(16,24,40,0.04) 0px 1px 4px",
      },
      fontFamily: {
        brand: ["Newsreader", "Georgia", "serif"],
        sans: ["Manrope", "IBM Plex Sans", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace"],
      },
      fontSize: {
        "rupiah-sm": ["1.25rem", { fontWeight: "700", lineHeight: "1.4", letterSpacing: "-0.5px" }],
        "rupiah-md": ["1.75rem", { fontWeight: "700", lineHeight: "1.2", letterSpacing: "-0.5px" }],
        "rupiah-lg": ["2.5rem", { fontWeight: "700", lineHeight: "1.1", letterSpacing: "-1px" }],
        "rupiah-xl": ["3rem", { fontWeight: "700", lineHeight: "1", letterSpacing: "-1px" }],
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.4s ease-out",
        "bounce-in": "bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        bounceIn: {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
