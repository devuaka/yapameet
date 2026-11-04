// GitHub Pages has no SPA rewrites: serving index.html as 404.html makes deep
// links like /meeting/abc-defg-hij load the app instead of GitHub's 404 page.
// Only done when SPA_404=1 (the GitHub Pages workflow sets it). Cloudflare Pages
// does SPA fallback on its own as long as there is NO 404.html, so we skip it there.
import { copyFileSync, existsSync } from 'node:fs';

if (process.env.SPA_404 === '1' && existsSync('dist/index.html')) {
  copyFileSync('dist/index.html', 'dist/404.html');
  console.log('spa-fallback: wrote dist/404.html');
}
