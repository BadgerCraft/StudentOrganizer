import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../capacitor.config';

assert.equal(config.appId, 'ca.on.teacher.assessment');
assert.equal(config.server?.hostname, 'localhost');
assert.equal(config.server?.iosScheme, 'capacitor');
assert.equal(config.server?.url, undefined, 'No live server may be configured');
assert.deepEqual(config.server?.allowNavigation, []);
assert.equal(config.loggingBehavior, 'none', 'Native logs must not expose backup content');
const generated = JSON.parse(readFileSync('ios/App/App/capacitor.config.json', 'utf8'));
assert.deepEqual(generated.packageClassList, [], 'Unexpected auto-registered plugin');
delete generated.packageClassList;
assert.deepEqual(generated, config, 'Run ios:prepare after configuration changes');
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /connect-src 'none'/);
assert.match(html, /worker-src 'none'/);
assert.doesNotMatch(html, /manifest|apple-mobile-web-app|https?:\/\//);
assert.equal(existsSync('dist/sw.js'), false);
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(match[1].startsWith('./'), `Non-bundled asset: ${match[1]}`);
  assert.ok(existsSync(join('dist', match[1])));
}
function compare(dir: string) {
  for (const item of readdirSync(join('dist', dir), {withFileTypes: true})) {
    const relative = join(dir, item.name);
    if (item.isDirectory()) compare(relative);
    else assert.deepEqual(readFileSync(join('dist', relative)), readFileSync(join('ios/App/App/public', relative)), `Stale native asset: ${relative}`);
  }
}
compare('');
const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
for (const name of ['FilesPlugin', 'PilotViewController', 'NativeBoundaryPlugin']) assert.match(project, new RegExp(`${name}\\.swift in Sources`));
const controller = readFileSync('ios/App/App/PilotViewController.swift', 'utf8');
for (const name of ['FilesPlugin', 'LocalNavigationPlugin', 'LocalOnlyHttpPlugin', 'BundledOnlyWebViewPlugin']) assert.ok(controller.includes(`registerPluginInstance(${name}())`));
console.log('PASS: stable identity/origin, no live URL, restrictive CSP, no worker, local asset references, exact synchronized asset bytes, registered native boundary/Files sources. Static audit only; NOT an iOS runtime result.');
