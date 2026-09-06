import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
	{ ignores: ["build/", ".svelte-kit/", "dist/", "src-tauri/target/"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs["flat/recommended"],
	prettier,
	...svelte.configs["flat/prettier"],
	{
		// Per eslint-plugin-svelte docs: enable TypeScript parsing in .svelte files.
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: { ...globals.browser },
			parserOptions: { parser: tseslint.parser, extraFileExtensions: [".svelte"] }
		}
	}
];
