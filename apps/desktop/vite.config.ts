import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  base: "./",
  plugins: [
    tanstackRouter({
      target: "react",
      quoteStyle: "double",
      routesDirectory: fileURLToPath(new URL("./src/renderer/app/routes", import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL("./src/renderer/app/route-tree.gen.ts", import.meta.url)),
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/renderer", import.meta.url)) },
  },
  build: { outDir: fileURLToPath(new URL("./out/renderer", import.meta.url)), emptyOutDir: true },
})
