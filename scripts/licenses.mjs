import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function bundledLicenses(root, inputs) {
  const packages = new Set();
  for (const input of Object.keys(inputs)) {
    const index = input.lastIndexOf('node_modules/');
    if (index < 0) continue;
    const parts = input.slice(index + 13).split('/');
    const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    packages.add(input.slice(0, index) + 'node_modules/' + name);
  }
  const sections = [];
  for (const directory of [...packages].sort()) {
    const file = new URL(join(directory, 'package.json'), root);
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    const names = await readdir(dirname(file.pathname));
    const licenseName = names.find(name => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
    if (!licenseName) throw new Error(`Missing license for bundled dependency: ${pkg.name}`);
    const license = await readFile(new URL(licenseName, new URL('./', file)), 'utf8');
    sections.push(`## ${pkg.name} ${pkg.version}\n\n${license.trim()}\n`);
  }
  return '# Bundled third-party licenses\n\nReact is supplied by DSH. The following notices cover code included in the browser bundle.\n\n' + sections.join('\n');
}
