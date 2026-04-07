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
          DEFAULT: "#7132f5",
          dark: "#5741d8",
          deep: "#5b1ecf",
          subtle: "rgba(133,91,251,0.16)",
        },
        bg: {
          DEFAULT: "#ffffff",
          secondary: "#ffffff",
          tertiary: "#f8f9fa",
          overlay: "rgba(16, 17, 20, 0.4)",
        },
        text: {
          primary: "#101114",
          secondary: "#686b82",
          muted: "#9497a9",
          inverse: "#ffffff",
        },
        border: {
          DEFAULT: "#dedee5",
          light: "#dedee5",
          subtle: "#f4f4f6",
        },
        semantic: {
          success: {
            DEFAULT: "#149e61",
            bg: "rgba(20,158,97,0.16)",
            text: "#026b3f"
          },
          neutral: {
            bg: "rgba(104,107,130,0.12)",
            text: "#484b5e"
          },
          danger: {
            DEFAULT: "#e3342f",
            bg: "#fee2e2",
            text: "#b91c1c"
          }
        },
        // We set legacy token names pointing to standard gray to prevent crash before full refactor
        coral: { DEFAULT: "#e3342f", light: "#fee2e2", dark: "#b91c1c", glow: "#fee2e2" },
        lime: { DEFAULT: "#149e61", light: "#d1fae5", dark: "#026b3f", glow: "#d1fae5" },
        cyan: { DEFAULT: "#686b82", light: "#9497a9", dark: "#101114", glow: "#f8f9fa" },
        amber: { DEFAULT: "#686b82", light: "#9497a9", dark: "#101114", glow: "#f8f9fa" },
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, #7132f5 0%, #5b1ecf 100%)",
        "gradient-primary": "linear-gradient(135deg, #7132f5 0%, #5741d8 100%)",
        "gradient-danger": "linear-gradient(135deg, #e3342f 0%, #b91c1c 100%)",
        "gradient-success": "linear-gradient(135deg, #149e61 0%, #026b3f 100%)",
        "gradient-card": "linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)",
        "gradient-cta": "linear-gradient(135deg, #7132f5 0%, #5b1ecf 100%)",
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
        brand: ["Kraken-Brand", "IBM Plex Sans", "Helvetica", "Arial", "sans-serif"],
        sans: ["Kraken-Product", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
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
