export default {
	// Lint and format JavaScript/TypeScript files
	"*.{js,jsx,ts,tsx}": ["biome check --write ."],
	// Format JSON, CSS, SCSS, and Markdown files
	"*.{css,scss,md}": ["biome check --write ."],
};
