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
          DEFAULT: "#7C3AED",
          light: "#A78BFA",
          dark: "#5B21B6",
          glow: "#7C3AED33",
        },
        coral: {
          DEFAULT: "#FF4D6D",
          light: "#FF8FA3",
          dark: "#C9184A",
          glow: "#FF4D6D33",
        },
        lime: {
          DEFAULT: "#22C55E",
          light: "#4ADE80",
          dark: "#15803D",
          glow: "#22C55E33",
        },
        cyan: {
          DEFAULT: "#06B6D4",
          light: "#67E8F9",
          dark: "#0E7490",
          glow: "#06B6D433",
        },
        amber: {
          DEFAULT: "#F59E0B",
          light: "#FCD34D",
          dark: "#B45309",
          glow: "#F59E0B33",
        },
        bg: {
          DEFAULT: "#0F172A",
          secondary: "#1E293B",
          tertiary: "#273449",
          overlay: "#0F172ACC",
        },
        text: {
          primary: "#F8FAFC",
          secondary: "#94A3B8",
          muted: "#64748B",
          inverse: "#0F172A",
        },
        border: {
          DEFAULT: "#334155",
          light: "#475569",
          subtle: "#1E293B",
        },
        category: {
          eat: "#FF4D6D",
          snack: "#F59E0B",
          groceries: "#22C55E",
          laundry: "#06B6D4",
          bensin: "#F97316",
          flazz: "#3B82F6",
          transport: "#8B5CF6",
          home: "#10B981",
          medicine: "#EC4899",
          others: "#6366F1",
          investasi: "#14B8A6",
          sedekah: "#FBBF24",
          uang_sampah: "#64748B",
          keamanan: "#EF4444",
        },
      },
      backgroundImage: {
        "gradient-hero": "linear-gradient(135deg, #7C3AED 0%, #FF4D6D 50%, #F59E0B 100%)",
        "gradient-primary": "linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)",
        "gradient-danger": "linear-gradient(135deg, #FF4D6D 0%, #F59E0B 100%)",
        "gradient-success": "linear-gradient(135deg, #22C55E 0%, #06B6D4 100%)",
        "gradient-card": "linear-gradient(135deg, #1E293B 0%, #273449 100%)",
        "gradient-cta": "linear-gradient(90deg, #7C3AED 0%, #06B6D4 100%)",
      },
      borderRadius: {
        "xl": "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      boxShadow: {
        "glow-primary": "0 0 20px #7C3AED55",
        "glow-coral": "0 0 20px #FF4D6D55",
        "glow-lime": "0 0 20px #22C55E55",
        "glow-cyan": "0 0 20px #06B6D455",
        "glow-amber": "0 0 20px #F59E0B55",
        "card": "0 4px 24px rgba(0, 0, 0, 0.4)",
        "card-hover": "0 8px 32px rgba(0, 0, 0, 0.6)",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "ui-monospace"],
      },
      fontSize: {
        "rupiah-sm": ["1.25rem", { fontWeight: "700", lineHeight: "1.4" }],
        "rupiah-md": ["1.75rem", { fontWeight: "800", lineHeight: "1.2" }],
        "rupiah-lg": ["2.5rem", { fontWeight: "900", lineHeight: "1.1" }],
        "rupiah-xl": ["3rem", { fontWeight: "900", lineHeight: "1" }],
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.4s ease-out",
        "pulse-glow": "pulseGlow 2s infinite",
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
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 10px #7C3AED55" },
          "50%": { boxShadow: "0 0 25px #7C3AED99" },
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
