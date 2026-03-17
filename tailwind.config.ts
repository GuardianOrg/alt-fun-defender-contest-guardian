import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a1e1b',
          1: '#0c1e1a',
          2: '#102520',
          3: '#163028',
        },
        mint: {
          DEFAULT: '#4de8b4',
          dim: '#2ab88a',
          hover: '#6ef0c2',
          bg: 'rgba(77,232,180,0.08)',
        },
        red: {
          DEFAULT: '#f05050',
          bg: 'rgba(240,80,80,0.07)',
        },
        amber: {
          DEFAULT: '#f0b429',
          bg: 'rgba(240,180,41,0.1)',
        },
        txt: {
          DEFAULT: '#eafaf4',
          2: 'rgba(234,250,244,0.55)',
          3: 'rgba(234,250,244,0.30)',
          4: 'rgba(234,250,244,0.14)',
        },
        border: {
          DEFAULT: 'rgba(77,232,180,0.12)',
          2: 'rgba(77,232,180,0.24)',
        },
        aqua: '#00ffcc',
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Courier New'", 'Courier', 'monospace'],
        display: ["'Oswald'", 'Impact', "'Arial Narrow'", 'sans-serif'],
      },
      boxShadow: {
        'mint-glow': '0 0 16px rgba(77,232,180,0.25)',
        'mint-glow-lg': '0 0 24px rgba(77,232,180,0.30)',
        'red-glow': '0 0 16px rgba(240,80,80,0.25)',
        'inner-mint': 'inset 0 0 8px rgba(77,232,180,0.15)',
        'panel': '0 1px 4px rgba(0,0,0,0.3)',
      },
      keyframes: {
        scrolltape: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        ambpulse: {
          '0%, 100%': { backgroundColor: '#0a1e1b' },
          '50%': { backgroundColor: '#0e2820' },
        },
        livep: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.2' },
        },
        badgep: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        barp: {
          '0%, 100%': { filter: 'brightness(1)' },
          '50%': { filter: 'brightness(1.8)' },
        },
        ltb: {
          '0%, 100%': { opacity: '0.7', filter: 'brightness(1)' },
          '50%': { opacity: '1', filter: 'brightness(1.3)' },
        },
        rowf: {
          '0%, 100%': { backgroundColor: 'rgba(77,232,180,0.04)' },
          '50%': { backgroundColor: 'rgba(77,232,180,0.09)' },
        },
        rowfs: {
          '0%, 100%': { backgroundColor: 'rgba(240,80,80,0.03)' },
          '50%': { backgroundColor: 'rgba(240,80,80,0.07)' },
        },
        athg: {
          '0%, 100%': { boxShadow: '0 0 0 rgba(240,180,41,0)' },
          '50%': { boxShadow: '0 0 12px rgba(240,180,41,0.4)' },
        },
        gradpulse: {
          '0%, 100%': { filter: 'brightness(1)', boxShadow: 'none' },
          '50%': { filter: 'brightness(1.5)', boxShadow: 'inset 0 0 6px rgba(77,232,180,0.25)' },
        },
        modalin: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        gp2: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        scrolltape: 'scrolltape 18s linear infinite',
        ambpulse: 'ambpulse 3.5s ease-in-out infinite',
        livep: 'livep 2s ease-in-out infinite',
        badgep: 'badgep 1.4s ease-in-out infinite',
        barp: 'barp 2s ease-in-out infinite',
        ltb: 'ltb 2.4s ease-in-out infinite',
        rowf: 'rowf 2.5s ease-in-out infinite',
        rowfs: 'rowfs 2.5s ease-in-out infinite',
        athg: 'athg 1.8s ease-in-out infinite',
        gradpulse: 'gradpulse 1.8s ease-in-out infinite',
        modalin: 'modalin 0.15s ease',
        gp2: 'gp2 2s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
