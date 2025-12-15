module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'index.js',
    '!**/node_modules/**',
    '!**/test/**'
  ],
  testMatch: [
    '**/test/**/*.test.js'
  ]
};
