import { defineConfig } from "electron-vite"
import renderer from "./vite.config"

export default defineConfig({
  main: {},
  preload: {
    build: { rollupOptions: { input: "src/preload/index.ts", output: { format: "cjs", entryFileNames: "index.cjs" } } },
  },
  renderer,
})
