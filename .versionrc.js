export default {
	// Bump version in package.json
	bumpFiles: ["package.json"],
	// Generate changelog from Conventional Commits
	types: [
		{ type: "feat", section: "Features" },
		{ type: "fix", section: "Bug Fixes" },
		{ type: "perf", section: "Performance Improvements" },
		{ type: "revert", section: "Reverts" },
		{ type: "docs", section: "Documentation", hidden: false },
		{ type: "style", section: "Styles", hidden: false },
		{ type: "chore", section: "Miscellaneous Chores", hidden: false },
		{ type: "refactor", section: "Code Refactoring", hidden: false },
		{ type: "test", section: "Tests", hidden: false },
		{ type: "build", section: "Build System", hidden: false },
		{ type: "ci", section: "Continuous Integration", hidden: false },
	],
	// Release commit message format
	releaseCommitMessageFormat: "chore(release): {{currentTag}}",
	// Skip bumping if no changes
	skip: {
		bump: false,
		changelog: false,
		commit: false,
		tag: false,
	},
};
