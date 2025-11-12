import path from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import fileProgressPlugin from "eslint-plugin-file-progress";
import jsdocPlugin from "eslint-plugin-jsdoc";
import prettierPlugin from "eslint-plugin-prettier";
import globals from "globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
	baseDirectory: __dirname,
});

const jsdocRecommended =
	jsdocPlugin.configs["flat/recommended"] ??
	jsdocPlugin.configs.recommended ??
	{};

const jsdocCheckTagRule =
	jsdocRecommended.rules?.["jsdoc/check-tag-names"] ?? "error";

const jsdocBaseSettings = jsdocRecommended.settings?.jsdoc ?? {};

const stripLegacyRules = (configs) =>
	configs.map((config) => {
		if (config.rules && Object.hasOwn(config.rules, "valid-jsdoc")) {
			const nextRules = { ...config.rules };
			delete nextRules["valid-jsdoc"];

			return {
				...config,
				rules: nextRules,
			};
		}

		return config;
	});

const googleConfigs = stripLegacyRules(compat.extends("google"));

export default defineConfig([
	{
		ignores: [
			"**/models",
			"**/repositories",
			"**/reports",
			"**/dist",
			"**/coverage",
		],
	},
	js.configs.recommended,
	...googleConfigs,
	...compat.extends("plugin:prettier/recommended", "eslint-config-prettier"),
	{
		plugins: {
			"file-progress": fileProgressPlugin,
			prettier: prettierPlugin,
			jsdoc: jsdocPlugin,
		},
		rules: {
			"file-progress/activate": 1,
			"prettier/prettier": [
				"error",
				{ endOfLine: "auto" },
				{ usePrettierrc: true },
			],
			"object-curly-spacing": ["error", "always"],
			quotes: ["error", "double", { avoidEscape: true }],
			curly: ["error", "all"],
			"jsdoc/check-tag-names": jsdocCheckTagRule,
			"new-cap": "off",
			"require-jsdoc": "off",
			semi: "error",
			"no-unused-expressions": "off",
			camelcase: "off",
			"no-invalid-this": "off",
		},
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			parserOptions: {
				requireConfigFile: false,
				ecmaFeatures: {
					experimentalDecorators: true,
				},
			},
			globals: {
				...globals.es2024,
				...globals.node,
				...globals.jest,
			},
		},
		settings: {
			jsdoc: {
				...jsdocBaseSettings,
				tagNamePreference: {
					arg: "param",
					argument: "param",
					class: "constructor",
					return: "return",
					virtual: "abstract",
				},
			},
		},
	},
	{
		files: ["**/*.ts"],
		plugins: {
			"@typescript-eslint": tsPlugin,
			jsdoc: jsdocPlugin,
		},
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.es2024,
				...globals.node,
				...globals.jest,
			},
		},
		rules: {
			"jsdoc/check-tag-names": jsdocCheckTagRule,
			"@typescript-eslint/explicit-function-return-type": "error",
			"@typescript-eslint/no-non-null-assertion": "off",
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "after-used",
					argsIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
		},
	},
	{
		files: [
			"**/common/**/*.ts",
			"**/bin/**/*.ts",
			"**/api/**/*.ts",
			"**/medusa-js/**/resources/**/*.ts",
		],
		rules: {
			"jsdoc/check-tag-names": "off",
		},
	},
	{
		files: ["**/__mocks__/**/*.ts"],
		rules: {
			"@typescript-eslint/explicit-function-return-type": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"jsdoc/check-tag-names": "off",
		},
	},
	{
		files: ["**/api/**/*.ts"],
		rules: {
			"jsdoc/check-tag-names": "off",
			"@typescript-eslint/explicit-function-return-type": "off",
			"@typescript-eslint/no-var-requires": "off",
		},
	},
]);
