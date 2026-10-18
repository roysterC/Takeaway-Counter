import { defineConfig } from "vitest/config";
import path from "path";

// Pure logic only: menu matching, money, hours, delivery, the order taken on
// a call and the voice turn-taking. Everything that touches the database is
// exercised against a real one (npm run seed -- --demo, the lab).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
