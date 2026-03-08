import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'hive-green': '#39ff14',
        'hive-gold': '#f5b429',
        'hive-bg': '#040507',
        'hive-bg2': '#07090c',
        'hive-text': '#e8f0e4',
        'hive-blue': '#4a9eff',
        'hive-purple': '#9b72ff',
        'hive-danger': '#ff5a5a',
      },
      fontFamily: {
        grotesk: ['var(--font-grotesk)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        hive: '16px',
      },
      boxShadow: {
        'green-glow': '0 0 20px rgba(57,255,20,0.3)',
        'gold-glow': '0 0 20px rgba(245,180,41,0.3)',
      },
    },
  },
  plugins: [],
};

export default config;
