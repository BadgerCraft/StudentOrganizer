/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ontario: {
          k: '#2563eb', // Blue: Knowledge & Understanding
          t: '#7c3aed', // Purple: Thinking & Inquiry
          c: '#059669', // Green: Communication
          a: '#ea580c', // Orange: Application
        }
      }
    },
  },
  plugins: [],
}
