import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "embeddings/**/*.test.ts",
      "structured-ai/**/*.test.ts",
      "sheet-benchmark/**/*.test.ts",
      "extraction-validation/**/*.test.ts",
    ],
  },
});
