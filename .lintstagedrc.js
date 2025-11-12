/**
 * @type {import('lint-staged').Configuration}
 */
export default {
	// Run ESLint, Prettier, and TypeScript type checking on TypeScript files
	"*.ts": (files) => {
		const commands = [
			`eslint --fix ${files.join(" ")}`,
			`prettier --write ${files.join(" ")}`,
		];
		// Type check the whole project once (not per file)
		if (files.length > 0) {
			commands.push("tsc --noEmit");
		}
		return commands;
	},
	// Run Prettier on other supported files
	"*.{js,json,md,yml,yaml}": ["prettier --write"],
};
