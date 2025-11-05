module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
        isolatedModules: false,
      },
    ],
  },
  moduleNameMapper: {
    "^@medusajs/framework/types$": "<rootDir>/node_modules/@medusajs/framework/dist/types/index.js",
    "^@medusajs/framework/utils$": "<rootDir>/node_modules/@medusajs/framework/dist/utils/index.js",
    "^@medusajs/framework/(.*)$": "<rootDir>/node_modules/@medusajs/framework/dist/$1",
  },
  extensionsToTreatAsEsm: [],
}
