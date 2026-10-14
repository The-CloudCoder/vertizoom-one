/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          950: '#102b46',
          900: '#173b5e',
          700: '#245f91',
          500: '#3789c8',
          100: '#eaf4fc'
        }
      }
    }
  },
  plugins: []
};
