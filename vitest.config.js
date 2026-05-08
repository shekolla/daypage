// Two test projects:
//  - "unit" runs the frontend pure-helper tests against status_tracker.jsx
//    in a happy-dom environment so React-using files load.
//  - "server" runs the Supertest integration tests against server/server.js
//    in a node environment with no DOM.
//
// Vitest 4 deprecated `defineWorkspace` in favor of inline `test.projects`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "unit",
          include: ["tests/**/*.test.{js,jsx}"],
          environment: "happy-dom",
          globals: false,
        },
      },
      {
        test: {
          name: "server",
          include: ["server/tests/**/*.test.js"],
          environment: "node",
          globals: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "lib/**",
        "components/**",
        "server/**/*.js",
        "status_tracker.jsx",
      ],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "tests/**",
        "server/tests/**",
        "scaffold/**",
        "**/*.test.{js,jsx}",
      ],
    },
  },
});
