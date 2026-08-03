/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['Cascadia Mono', 'Consolas', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
