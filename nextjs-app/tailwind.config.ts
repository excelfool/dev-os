import type { Config } from 'tailwindcss';

/**
 * Token source of truth: docs/design.md (allNeurons design system).
 * Semantic names only — components never reference a raw hex value.
 * Confidence band colours are contrast-checked in spec 16 §1: warning-500
 * fails 4.5:1 on white and is a fill/border token only, never text.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#E7EFFC', 100: '#B6CFF5', 500: '#115ACB',
          600: '#0044AE', 700: '#0D469E', 900: '#082A5E',
        },
        grey: {
          25: '#FAFAFA', 50: '#F0F0F1', 100: '#DADADB', 200: '#C1C2C3',
          300: '#8F9193', 400: '#5E6062', 500: '#4A4C4F', 600: '#2C2F32',
          700: '#25272B', 800: '#151719', 900: '#070A0E',
        },
        success: { 50: '#E7F6E7', 500: '#13A10E', 600: '#11930D', 700: '#0D720A' },
        warning: { 50: '#FFF9F0', 100: '#FFF2E0', 500: '#FFAA33', 700: '#DB8000', 800: '#B36800', 900: '#854D00' },
        danger: { 50: '#FAEBEB', 100: '#F1C0C1', 500: '#D13438', 600: '#BE2F33', 700: '#942528' },
        accent: { 500: '#7F00FF', 700: '#6600CC' },
      },
      fontFamily: {
        sans: ['Inter Display', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // docs/design.md type scale — size / line-height / weight
        h1: ['48px', { lineHeight: '56px', fontWeight: '700' }],
        h2: ['36px', { lineHeight: '44px', fontWeight: '700' }],
        h3: ['30px', { lineHeight: '38px', fontWeight: '600' }],
        h4: ['28px', { lineHeight: '36px', fontWeight: '600' }],
        h5: ['24px', { lineHeight: '32px', fontWeight: '500' }],
        body: ['16px', { lineHeight: '24px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },
      spacing: {
        // 4px grid, named steps from docs/design.md
        section: '40px', subsection: '24px', component: '32px',
        'page-y': '96px', 'page-x': '112px',
      },
      borderRadius: {
        card: '8px', btn: '6px', badge: '4px', input: '6px', modal: '12px',
      },
    },
  },
  plugins: [],
};

export default config;
