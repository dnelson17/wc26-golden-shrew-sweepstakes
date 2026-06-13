/**
 * Conventional Commits, with one project-specific addition: the `data` type,
 * used by the hourly results-bot (`data: update results … [skip ci]`).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'perf',
        'docs',
        'style',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
        'data',
      ],
    ],
  },
};
