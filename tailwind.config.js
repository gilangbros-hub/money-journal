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
          DEFAULT: "#1D4A86",
          dark: "#143765",
          deep: "#0B213F",
          subtle: "rgba(29, 74, 134, 0.14)",
        },
        bg: {
          DEFAULT: "#FDF7EA",
          secondary: "#F8F1DF",
          tertiary: "#EFE6CF",
          overlay: "rgba(11, 33, 63, 0.45)",
        },
        text: {
          primary: "#0B213F",
          secondary: "#1D4A86",
          muted: "#6B7B96",
          inverse: "#ffffff",
        },
        border: {
          DEFAULT: "#E5D9BC",
          light: "#EAE0C7",
          subtle: "#F3ECD9",
        },
        semantic: {
          success: {
            DEFAULT: "#1D4A86",
            bg: "rgba(29, 74, 134, 0.12)",
            text: "#0B213F"
          },
          neutral: {
            bg: "rgba(11, 33, 63, 0.08)",
            text: "#35405b"
          },
          danger: {
            DEFAULT: "#ED3F27",
            bg: "#FCD9D4",
            text: "#B82F1D"
          }
        },
        // We set legacy token names pointing to standard gray to prevent crash before full refactor
        coral: { DEFAULT: "#ED3F27", light: "#FCD9D4", dark: "#B82F1D", glow: "#FCD9D4" },
        lime: { DEFAULT: "#1D4A86", light: "#D2DFF0", dark: "#0B213F", glow: "#D2DFF0" },
        cyan: { DEFAULT: "#1D4A86", light: "#D2DFF0", dark: "#0B213F", glow: "#D2DFF0" },
        amber: { DEFAULT: "#F9A41E", light: "#FDE9CA", dark: "#C27A10", glow: "#FDE9CA" },
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, #1D4A86 0%, #143765 100%)",
        "gradient-primary": "linear-gradient(135deg, #1D4A86 0%, #143765 100%)",
        "gradient-danger": "linear-gradient(135deg, #ED3F27 0%, #B82F1D 100%)",
        "gradient-success": "linear-gradient(135deg, #1D4A86 0%, #0B213F 100%)",
        "gradient-card": "linear-gradient(135deg, #F8F1DF 0%, #EFE6CF 100%)",
        "gradient-cta": "linear-gradient(135deg, #F9A41E 0%, #F18F08 100%)",
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
