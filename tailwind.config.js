/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        felt: '#35654d',
        feltDark: '#234f3b',
        gold: '#ffd700',
      },
      boxShadow: {
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.15)',
        'inner-felt': 'inset 0 0 100px rgba(0,0,0,0.5)',
      }
    },
  },
  plugins: [],
}