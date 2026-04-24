/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html', './ui.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: '#f6f7f9',
        ink: '#15171c',
        brand: {
          50:  '#fff1f3',
          100: '#ffe1e6',
          500: '#ff3e5f',
          600: '#ed1f43',
          700: '#c41635',
        },
      },
    },
  },
  plugins: [],
};
