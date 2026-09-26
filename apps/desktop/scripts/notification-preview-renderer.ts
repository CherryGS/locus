import { join } from "node:path"
import { build } from "vite"
import { desktop, workspace } from "./fixture.ts"

export async function notificationPreviewRenderer() {
  const outDir = join(workspace, "target", "notification-sample", "renderer")
  await build({
    configFile: join(desktop, "vite.config.ts"),
    plugins: [
      {
        name: "notification-examples",
        transformIndexHtml: {
          order: "pre",
          handler: () => [
            {
              tag: "script",
              attrs: {
                type: "module",
                src: `/@fs/${join(desktop, "scripts", "notification-examples.tsx").replaceAll("\\", "/")}`,
              },
              injectTo: "body",
            },
          ],
        },
      },
    ],
    build: { outDir },
  })
  return outDir
}
