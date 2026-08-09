import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["e2e/**", "node_modules/**"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
  },
});
