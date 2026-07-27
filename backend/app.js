// Entry point that konsoleH's Node.js runner executes (Script path: app.js).
// It simply boots the compiled Express server. Environment variables (PORT,
// DATABASE_URL, JWT_SECRET, …) come from the konsoleH Node.js config, not a
// .env file — so there is nothing to load here.
//
// Build the server first (`npm run build` → dist/server.js) before starting.
require("./dist/server.js");
