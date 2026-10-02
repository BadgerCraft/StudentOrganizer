const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const pkg = require('../package.json');

const runNumber = process.env.GITHUB_RUN_NUMBER || '0';
const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tag = process.env.GITHUB_REF_NAME || '';
if (!/^\d+$/.test(runNumber) || !/^\d+$/.test(attempt) || !/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error('Invalid QA build identity.');
}
if (process.env.GITHUB_REF_TYPE === 'tag' && !/^qa-v\d+\.\d+\.\d+-qa\.\d+\.\d+$/.test(tag)) {
  throw new Error('QA release tag must have the form qa-v1.0.0-qa.42.1.');
}
const version = process.env.GITHUB_REF_TYPE === 'tag'
  ? tag.slice(4) : `${pkg.version}-qa.${runNumber}.${attempt}`;
const buildId = `${version} (${commit.slice(0, 8)})`;
const metadata = {
  version, buildId, commit,
  runUrl: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  createdAt: new Date().toISOString()
};
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/qa-build.json', JSON.stringify(metadata, null, 2) + '\n');
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `QA_VERSION=${version}\nVITE_QA_BUILD_ID=${buildId}\n`);
}
console.log(`QA build: ${buildId}`);
