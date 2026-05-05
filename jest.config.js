/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  // Single writer for SQLite — prevents intermittent "Operation has timed out"
  // when multiple integration suites race on prisma writes.
  maxWorkers: 1,
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    "^@/(.*)\\.js$": "<rootDir>/src/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "esnext",
          target: "ES2022",
          moduleResolution: "bundler",
          esModuleInterop: true,
          jsx: "react-jsx",
          isolatedModules: true,
          allowJs: true,
        },
      },
    ],
  },
};

module.exports = config;
