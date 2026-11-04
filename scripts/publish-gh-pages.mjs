// Publish to GitHub Pages using only the GitHub CLI (no git needed).
//   npm run publish:gh            -> builds, pushes source to `main`, built site to `gh-pages`
// Env: GH_REPO=owner/name (default: <your gh user>/yapameet), SKIP_SOURCE=1 to only update the site.
// Requires `gh auth login`. The repo must be public for free GitHub Pages.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const gh = (args, input) =>
  execFileSync('gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const api = (method, path, body) => {
  const out = gh(['api', '-X', method, path, ...(body ? ['--input', '-'] : [])], body ? JSON.stringify(body) : undefined);
  return out ? JSON.parse(out) : null;
};
const tryApi = (...a) => {
  try {
    return api(...a);
  } catch {
    return null;
  }
};

const user = gh(['api', 'user', '--jq', '.login']).trim();
const repo = process.env.GH_REPO || `${user}/yapameet`;
const name = repo.split('/')[1];
console.log(`Publishing to ${repo}`);

if (!tryApi('GET', `repos/${repo}`)) {
  console.log('Creating public repository…');
  gh(['repo', 'create', repo, '--public', '--add-readme', '--description', 'Yapameet: free peer-to-peer video meetings in the browser']);
}

console.log(`Building with base /${name}/ …`);
execSync('npm run build', {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: process.env.VITE_BASE || `/${name}/`, SPA_404: '1' },
});

function walk(dir, skip) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (skip(entry, full)) continue;
    if (statSync(full).isDirectory()) files.push(...walk(full, skip));
    else files.push(full);
  }
  return files;
}

function pushTree(branch, root, files, extra, message) {
  const tree = [];
  const all = [...files.map((f) => [relative(root, f).split(sep).join('/'), readFileSync(f)]), ...extra];
  let i = 0;
  for (const [path, buf] of all) {
    const blob = api('POST', `repos/${repo}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write(`\r  ${branch}: uploaded ${++i}/${all.length}`);
  }
  process.stdout.write('\n');
  const t = api('POST', `repos/${repo}/git/trees`, { tree });
  const ref = tryApi('GET', `repos/${repo}/git/ref/heads/${branch}`);
  const parents = ref ? [ref.object.sha] : [];
  const commit = api('POST', `repos/${repo}/git/commits`, { message, tree: t.sha, parents });
  if (ref) api('PATCH', `repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
  else api('POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  console.log(`  ${branch} -> ${commit.sha.slice(0, 7)}`);
}

const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

if (process.env.SKIP_SOURCE !== '1') {
  // .github is skipped: pushing workflow files needs a token with the `workflow` scope.
  const skipNames = new Set(['node_modules', 'dist', '.github', '.claude', '.wrangler', '.env', '.env.local']);
  const src = walk('.', (n, full) => skipNames.has(n) || full.endsWith(join('public', 'mediapipe')) || n.endsWith('.log') || n.endsWith('.tsbuildinfo'));
  pushTree('main', '.', src, [], `Yapameet source (${stamp})`);
}

pushTree('gh-pages', 'dist', walk('dist', () => false), [['.nojekyll', Buffer.from('')]], `Deploy site (${stamp})`);

if (!tryApi('GET', `repos/${repo}/pages`)) {
  console.log('Enabling GitHub Pages from gh-pages…');
  api('POST', `repos/${repo}/pages`, { source: { branch: 'gh-pages', path: '/' } });
}
const pages = tryApi('GET', `repos/${repo}/pages`);
console.log(`\nDone. Site: ${pages?.html_url || `https://${user}.github.io/${name}/`} (first deploy can take a minute or two)`);
