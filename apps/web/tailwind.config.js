/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"IBM Plex Serif"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        taxpro: {
          bg: '#F8F9FA',
          surface: '#FFFFFF',
          navy: '#0A192F',
          text: '#0A192F',
          muted: '#596273',
          green: '#10B981',
          'green-soft': '#E8F7F0',
          blue: '#3B82F6',
        },
        brand: {
          50: '#F8F9FA',
          100: '#E8F7F0',
          500: '#10B981',
          600: '#0A192F',
          700: '#060D18',
        },
      },
      borderRadius: {
        button: '6px',
        input: '6px',
        card: '12px',
      },
    },
  },
  plugins: [],
};
