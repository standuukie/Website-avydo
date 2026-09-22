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
        paper: {
          DEFAULT: '#FFFFFF',
          muted: '#F6F6F7',
        },
        ink: {
          50: '#FAFAFA',
          100: '#F1F1F2',
          200: '#E1E1E3',
          300: '#C7C7CB',
          400: '#9C9CA3',
          500: '#75757C',
          600: '#56565C',
          700: '#3F3F45',
          800: '#29292D',
          900: '#18181B',
          950: '#0D0D0F',
        },
        brand: {
          50: '#FDECED',
          100: '#FAD2D5',
          200: '#F3A7AD',
          300: '#E97981',
          400: '#DC4B54',
          500: '#CF2530',
          600: '#C8102E',
          700: '#9C0D24',
          800: '#740A1B',
          900: '#4D0712',
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
        card: '0 1px 2px rgba(24, 24, 27, 0.06), 0 8px 24px -12px rgba(24, 24, 27, 0.16)',
        'card-hover': '0 2px 4px rgba(24, 24, 27, 0.08), 0 16px 32px -12px rgba(24, 24, 27, 0.22)',
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
