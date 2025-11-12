import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";
import { defineConfig } from "vitest/config";

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
			copyDtsFiles: true,
			tsconfigPath: resolve(__dirname, "tsconfig.json"),
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
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "node",
		include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		globals: false,
		sequence: {
			hooks: "list",
		},
		testTimeout: 1000000000, // 1e9 milliseconds to match jest.setTimeout(1e9)
	},
});
