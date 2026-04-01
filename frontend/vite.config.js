import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true, // fail instead of silently switching ports
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesiumStatic"),
  },
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesiumStatic" },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesiumStatic" },
        { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesiumStatic" },
        { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesiumStatic" },
      ],
    }),
  ],
});