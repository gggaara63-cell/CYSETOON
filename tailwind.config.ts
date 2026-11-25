/** Preflight dimatikan: gaya dasar ada di src/styles/app.css + tokens.css. Utilitas Tailwind boleh dipakai, warna lewat variabel token. */
const colors = ['bg', 'surface', 'surface-sunk', 'border', 'border-input', 'text', 'text-muted', 'brand', 'on-brand', 'accent', 'on-accent', 'accent-text', 'danger', 'success'];
const config = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    screens: { m: '560px', l: '960px', xl: '1280px' },
    extend: {
      colors: Object.fromEntries(colors.map((n) => [n, `var(--color-${n})`])),
      fontFamily: { display: 'var(--font-display)', text: 'var(--font-text)' },
      borderRadius: { plate: 'var(--radius-plate)', control: 'var(--radius-control)', input: 'var(--radius-input)' },
    },
  },
  plugins: [],
};
export default config;
