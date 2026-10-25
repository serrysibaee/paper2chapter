import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) versions[targetVersion] = minAppVersion;

// Obsidian's directory and BRAT read manifest.json and versions.json from the repository root, so the
// root keeps an exact copy of both.
for (const dir of ['.', '..']) {
	writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, '\t') + '\n');
	writeFileSync(`${dir}/versions.json`, JSON.stringify(versions, null, '\t') + '\n');
}
