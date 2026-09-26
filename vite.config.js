import { defineConfig } from "vite";
import path from "path";
export default defineConfig({
  root: "public",
  resolve: {
    alias: { "three/addons": path.resolve("node_modules/three/examples/jsm") }
  },
  server: { port: 5173 }
});
