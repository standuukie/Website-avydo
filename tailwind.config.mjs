import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    container: {
      center: true,
      padding: '1.25rem',
    },
    extend: {
      colors: {
        ink: {
          DEFAULT: '#182430',
          light: '#3A4A57',
        },
        paper: {
          DEFAULT: '#FAF7F2',
          muted: '#F2EDE4',
        },
        navy: {
          50: '#EEF3F6',
          100: '#D6E1E9',
          200: '#AEC3D2',
          300: '#84A3B9',
          400: '#5C82A0',
          500: '#3D6484',
          600: '#2A4A63',
          700: '#1E3648',
          800: '#152735',
          900: '#0E1B24',
          950: '#0A141B',
        },
        copper: {
          50: '#FBF3E8',
          100: '#F4DFC0',
          200: '#EAC594',
          300: '#DEA968',
          400: '#CB8B47',
          500: '#B0713A',
          600: '#8F5A2E',
          700: '#6E4423',
          800: '#4C2F18',
          900: '#2E1C0E',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        'content': '72rem',
        'prose-wide': '48rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(14, 27, 36, 0.06), 0 8px 24px -12px rgba(14, 27, 36, 0.18)',
        'card-hover': '0 2px 4px rgba(14, 27, 36, 0.08), 0 16px 32px -12px rgba(14, 27, 36, 0.24)',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '14px',
      },
      animation: {
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [typography],
};
