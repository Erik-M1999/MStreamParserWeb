// Tailwind v4 hooks into the build through this single PostCSS plugin.
// No tailwind.config.js and no autoprefixer needed — v4 handles both itself.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
