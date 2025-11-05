import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dts from "vite-plugin-dts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    // Generate TypeScript declaration files
    dts({
      include: ["src/**/*"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/__mocks__/**",
        "src/**/__fixtures__/**",
      ],
      outDir: "dist",
      rollupTypes: true,
      copyDtsFiles: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "MedusaPaymentPhonePe",
      fileName: "index",
      formats: ["cjs"],
    },
    outDir: "dist",
    sourcemap: true,
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: false, // Keep console logs for debugging
        drop_debugger: true,
        passes: 2, // Multiple passes for better minification
      },
      format: {
        comments: false, // Remove comments
      },
    },
    rollupOptions: {
      output: {
        // Preserve directory structure for proper module resolution
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
        // Ensure consistent naming
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      external: (id) => {
        // Externalize peer dependencies
        if (
          id === "@medusajs/framework" ||
          id.startsWith("@medusajs/framework/") ||
          id === "axios" ||
          id === "express" ||
          id === "typeorm" ||
          // Externalize Node.js built-ins
          id.startsWith("node:") ||
          [
            "crypto",
            "fs",
            "path",
            "os",
            "http",
            "https",
            "url",
            "util",
            "stream",
            "events",
            "buffer",
            "querystring",
            "zlib",
            "net",
            "tls",
            "child_process",
            "cluster",
            "dgram",
            "dns",
            "readline",
            "repl",
            "string_decoder",
            "timers",
            "tty",
            "vm",
            "worker_threads",
          ].includes(id)
        ) {
          return true;
        }
        // Don't externalize local dependencies
        return false;
      },
    },
    target: "node18",
    // Don't bundle dependencies - they're peer dependencies
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
