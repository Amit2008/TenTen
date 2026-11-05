// T28 release candidate. Usage: npm run release
// From a clean, committed tree: builds the static site for the nested GitHub Pages base (/TenTen/) and the origin
// root, checks every content pointer in each build, writes SHA-256 sums and a release manifest, and archives the
// source at the recorded commit. Nothing is uploaded; publishing is a separate, authorized step (see the runbook).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OUT = 'release';
const TARGETS = [
  { name: 'nested', base: '/TenTen/' },
  { name: 'root', base: '/' },
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

// shortcut: requires a clean tree so the artifact matches a commit exactly; pass --allow-dirty only for a dry run.
const dirty = git('status', '--porcelain');
if (dirty && !process.argv.includes('--allow-dirty')) fail(`working tree is not clean:\n${dirty}`);
const commit = git('rev-parse', 'HEAD');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const files = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => join(dir, String(f)))
    .filter((f) => statSync(f).isFile())
    .sort();
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path, what) => {
  if (!existsSync(path)) fail(`${what} is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`${what} is not valid JSON: ${path}`);
  }
};

/** index.json → manifest → every content file and audio file it names must exist, parse and agree on the version. */
function checkContent(dir) {
  const content = join(dir, 'content');
  const index = json(join(content, 'index.json'), 'content index');
  const manifest = json(join(content, index.manifest), 'manifest');
  if (manifest.content_version !== index.content_version)
    fail(`index says ${index.content_version} but ${index.manifest} says ${manifest.content_version}`);
  const release = join(content, index.manifest, '..');
  const parsed = Object.fromEntries(Object.entries(manifest.files).map(([key, file]) => [key, json(join(release, file), key)]));
  for (const asset of [...Object.values(parsed.audio.effects ?? {}), ...(parsed.audio.music_tracks ?? [])])
    if (asset && !existsSync(join(release, asset))) fail(`audio file missing: ${asset}`);
  return { contentVersion: index.content_version, manifest: index.manifest };
}

const targets = [];
for (const { name, base } of TARGETS) {
  const dir = join(OUT, name);
  // No shell: a POSIX shell on Windows (Git Bash) would rewrite "/" into a Windows path.
  const vite = join('node_modules', 'vite', 'bin', 'vite.js');
  const build = spawnSync(process.execPath, [vite, 'build', '--base', base, '--outDir', dir, '--emptyOutDir'], { stdio: 'inherit' });
  if (build.status !== 0) fail(`build for ${base} failed`);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  if (!html.includes(`src="${base}assets/`)) fail(`${dir}/index.html does not load its script from ${base}assets/`);
  const content = checkContent(dir);
  const list = files(dir).map((f) => ({ path: relative(dir, f).split(sep).join('/'), bytes: statSync(f).size, sha256: sha256(f) }));
  writeFileSync(join(OUT, `${name}.sha256`), list.map((f) => `${f.sha256}  ${f.path}`).join('\n') + '\n');
  targets.push({ name, base, dir: dir.split(sep).join('/'), ...content, files: list.length, bytes: list.reduce((a, f) => a + f.bytes, 0) });
}

const source = join(OUT, `line-garden-src-${commit.slice(0, 7)}.zip`);
git('archive', '--format=zip', '-o', source, commit);

const lock = sha256('package-lock.json');
const manifest = {
  name: 'line-garden',
  commit,
  builtAt: new Date().toISOString(),
  node: process.version,
  npm: /npm\/(\S+)/.exec(process.env.npm_config_user_agent ?? '')?.[1] ?? 'not run through npm',
  packageLockSha256: lock,
  targets,
  source: { path: source.split(sep).join('/'), sha256: sha256(source) },
};
writeFileSync(join(OUT, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
