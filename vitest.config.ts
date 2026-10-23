// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// hub/api/*.js import ./_bot.mjs, the esbuild bundle of bot/runner/hubEntry.ts that only
// the hub/vercel.json buildCommand writes (gitignored). Tests resolve it to the TS source.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      alias: [
        { find: /^(?:\.\.?\/)+(?:hub\/api\/)?_bot\.mjs$/, replacement: fileURLToPath(new URL("./bot/runner/hubEntry.ts", import.meta.url)) },
      ],
    },
  }),
);
