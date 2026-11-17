import { getSettings } from './settings';
import { getAudioContext, loadSfx } from './sounds';

/** The "Yikes" secret: a monster face lunges at the screen with a scream. */
const FACE = `
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
  <defs>
    <radialGradient id="ys-skin" cx="50%" cy="42%" r="60%">
      <stop offset="0" stop-color="#c9d2b4"/><stop offset="0.6" stop-color="#7d8a6a"/><stop offset="1" stop-color="#1d2318"/>
    </radialGradient>
    <radialGradient id="ys-eye" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff9d6"/><stop offset="0.75" stop-color="#e8dca0"/><stop offset="1" stop-color="#7a6a30"/>
    </radialGradient>
    <radialGradient id="ys-iris" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ff2a00"/><stop offset="1" stop-color="#5a0000"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" fill="#000"/>
  <ellipse cx="200" cy="215" rx="175" ry="205" fill="url(#ys-skin)"/>
  <path d="M60 120 Q200 60 340 120 Q300 90 200 92 Q100 90 60 120Z" fill="#1d2318" opacity="0.7"/>
  <path d="M70 150 L175 175 L165 150 Z M330 150 L225 175 L235 150 Z" fill="#14180f"/>
  <ellipse cx="128" cy="200" rx="58" ry="46" fill="url(#ys-eye)"/>
  <ellipse cx="272" cy="200" rx="58" ry="46" fill="url(#ys-eye)"/>
  <circle cx="132" cy="204" r="25" fill="url(#ys-iris)"/>
  <circle cx="268" cy="204" r="25" fill="url(#ys-iris)"/>
  <circle cx="132" cy="204" r="6" fill="#000"/>
  <circle cx="268" cy="204" r="6" fill="#000"/>
  <path d="M90 175 Q128 160 170 182 M230 182 Q272 160 310 175" stroke="#3b0f0f" stroke-width="5" fill="none"/>
  <path d="M190 245 L200 230 L210 245 Z" fill="#2b3122"/>
  <path d="M80 275 Q200 255 320 275 Q310 390 200 398 Q90 390 80 275 Z" fill="#120404"/>
  <path d="M86 280 Q200 262 314 280 Q300 300 200 296 Q100 300 86 280 Z" fill="#8a1020"/>
  <path d="M95 280 L108 318 L120 282 L133 322 L146 283 L160 326 L173 284 L187 328 L200 285 L213 328 L227 284 L240 326 L254 283 L267 322 L280 282 L292 318 L305 280 Z" fill="#f4eed8"/>
  <path d="M110 385 L122 348 L134 384 L147 344 L160 386 L173 342 L187 388 L200 342 L213 388 L227 342 L240 386 L253 344 L266 384 L278 348 L290 385 Z" fill="#e9e1c4"/>
  <path d="M150 300 Q200 330 250 300" stroke="#300" stroke-width="3" fill="none" opacity="0.5"/>
</svg>`;

export function jumpscare() {
  const s = getSettings();
  const el = document.createElement('div');
  el.className = `yikes ${s.reduceMotion ? 'calm' : ''}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'A monster face jumps at you');
  el.dataset.testid = 'jumpscare';
  el.innerHTML = `<div class="yikes-face">${FACE}</div>`;
  document.body.appendChild(el);
  window.setTimeout(() => el.classList.add('out'), 1300);
  window.setTimeout(() => el.remove(), 1700);
  void loadSfx('egg-yikes').then((buf) => {
    if (!buf || !s.sounds) return;
    const ctx = getAudioContext();
    const g = ctx.createGain();
    g.gain.value = s.soundVolume;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g).connect(ctx.destination);
    src.start();
  });
}
