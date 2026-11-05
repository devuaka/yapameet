// End-to-end test: two separate browser processes (Chrome + Edge, separate
// profiles) join the same meeting through the REAL signaling service and
// exchange real WebRTC media from Chrome's fake camera/mic devices.
//
//   npm run dev            (in another terminal)
//   npm run test:e2e
//
// Env: BASE_URL (default http://localhost:8777), HEADED=1 to watch,
//      BROWSER_A / BROWSER_B = chrome | msedge (defaults chrome / msedge).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync as readFixture, statSync as statFixture, writeFileSync as writeFixture } from 'node:fs';

/** A 12 s test clip, recorded once in the browser and served with HTTP range support. */
const CLIP = new URL('./fixtures/clip.webm', import.meta.url);
async function ensureClip(page) {
  if (existsSync(CLIP)) return;
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  const b64 = await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 640;
    cv.height = 360;
    const g = cv.getContext('2d');
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 600000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const t0 = performance.now();
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      g.fillStyle = `hsl(${(t * 40) % 360} 70% 45%)`;
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff';
      g.font = 'bold 120px sans-serif';
      g.fillText(t.toFixed(1), 160, 220);
    }, 33);
    rec.start(500);
    await new Promise((r) => setTimeout(r, 12000));
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    clearInterval(timer);
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = '';
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  });
  writeFixture(CLIP, Buffer.from(b64, 'base64'));
}
function serveClip() {
  const server = createServer((req, res) => {
    const data = readFixture(CLIP);
    const size = statFixture(CLIP).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = Number(m[1] || 0);
      const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/webm', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      res.end(data.subarray(start, end + 1));
    } else {
      res.writeHead(200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': size });
      res.end(data);
    }
  });
  return new Promise((r) => server.listen(8779, () => r(server)));
}
const videoTime = (page) => page.evaluate(() => {
  const v = document.querySelector('[data-testid="watch-video"]');
  return v ? { t: v.currentTime, paused: v.paused } : null;
});


const BASE = process.env.BASE_URL || 'http://localhost:8777';
const HEADED = process.env.HEADED === '1';
const results = [];
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note });
    console.log(`  PASS  ${name} (${Date.now() - t0} ms)${note ? ` - ${note}` : ''}`);
  } catch (err) {
    failed++;
    results.push({ name, ok: false, ms: Date.now() - t0, note: String(err?.message || err) });
    console.log(`  FAIL  ${name}: ${err?.message || err}`);
  }
}

async function until(fn, { timeout = 20000, interval = 250, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
}

async function launch(channel, label) {
  const browser = await chromium.launch({
    channel,
    headless: !HEADED,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream=device-count=2',
      '--autoplay-policy=no-user-gesture-required',
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-accept-this-tab-capture',
      '--enable-features=GetDisplayMediaSetAutoSelectAllScreens',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['camera', 'microphone'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('[yapameet]')) console.log(`    [${label} console] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`    [${label} pageerror] ${e.message}`));
  return { browser, context, page, label };
}

/** Inbound RTP stats from the session's peer connections. */
const inbound = (page) =>
  page.evaluate(async () => {
    const s = window.__yapameet;
    if (!s) return null;
    const out = { audioBytes: 0, audioEnergy: 0, audioLevel: 0, videoFrames: 0, videoWidth: 0, pcs: 0 };
    for (const link of s.links.values()) {
      if (!link.pc) continue;
      out.pcs++;
      const stats = await link.pc.getStats();
      stats.forEach((r) => {
        if (r.type !== 'inbound-rtp') return;
        if (r.kind === 'audio') {
          out.audioBytes += r.bytesReceived || 0;
          out.audioEnergy += r.totalAudioEnergy || 0;
          out.audioLevel = Math.max(out.audioLevel, r.audioLevel || 0);
        } else if (r.kind === 'video') {
          out.videoFrames += r.framesDecoded || 0;
          out.videoWidth = Math.max(out.videoWidth, r.frameWidth || 0);
        }
      });
    }
    return out;
  });

const count = (page) => page.locator('[data-testid="participant-count"]').innerText().then((t) => parseInt(t.trim(), 10));

/**
 * A remote tile whose <video> is rendering NEW frames. (currentTime keeps advancing
 * on a frozen MediaStream, so count real frames with requestVideoFrameCallback.)
 */
const remoteVideoPlaying = (page, kind = 'cam') =>
  page.evaluate(async (kind) => {
    const v = document.querySelector(`[data-testid="tile-remote-${kind}"] video`);
    if (!v || !v.videoWidth) return false;
    const frames = await new Promise((res) => {
      let n = 0;
      const cb = () => {
        n++;
        v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
      setTimeout(() => res(n), 700);
    });
    return frames >= 2 ? `${v.videoWidth}x${v.videoHeight}` : false;
  }, kind);

const dump = (page) =>
  page.evaluate(() => {
    const s = window.__yapameet;
    if (!s) return 'no session';
    const v = document.querySelector('[data-testid="tile-remote-cam"] video');
    return JSON.stringify({
      signal: s.signal.status,
      links: [...s.links.values()].map((l) => ({ init: l.initiator, conn: l.conn, pcId: l.pcId, sig: l.pc?.signalingState, cs: l.pc?.connectionState, att: l.attempts, video: l.info.video })),
      tile: v ? { w: v.videoWidth, paused: v.paused, t: v.currentTime, rs: v.readyState, tracks: v.srcObject?.getTracks().map((t) => t.readyState + (t.muted ? '/muted' : '')) } : document.querySelector('[data-testid="tile-remote-cam"]')?.outerHTML.slice(0, 200),
    });
  });

async function withDump(fn) {
  try {
    return await fn();
  } catch (err) {
    console.log('    A:', await dump(A.page).catch((e) => e.message));
    console.log('    B:', await dump(B.page).catch((e) => e.message));
    throw err;
  }
}

/** A short sine-wave WAV file, used to test soundboard uploads. */
function makeWav(seconds = 1.5, freq = 523) {
  const sr = 44100;
  const n = Math.floor(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 20000), 44 + i * 2);
  return buf;
}

/** Audio energy B receives on the soundboard / screen-audio channel (transceiver 3). */
const boardEnergy = (page) =>
  page.evaluate(async () => {
    for (const l of window.__yapameet.links.values()) {
      const mid = l.pc.getTransceivers()[3].mid;
      let e = 0;
      (await l.pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.mid === mid) e = r.totalAudioEnergy || 0;
      });
      return e;
    }
    return 0;
  });


/** Open Activities (home grid), optionally jump into one activity page. */
const openTools = async (page, activity) => {
  if (!(await page.locator('[data-testid="activities-panel"]').count())) await page.locator('[data-testid="ctrl-tools"]').click();
  await page.locator('[data-testid="activities-panel"]').waitFor();
  if (await page.locator('[data-testid="act-back"]').count()) await page.locator('[data-testid="act-back"]').click();
  if (activity) await page.locator(`[data-testid="act-${activity}"]`).click();
};
const closeSide = async (page) => {
  if (await page.locator('[data-testid="side-panel"]').count()) await page.locator('[data-testid="side-close"]').click();
};
/** Pick an item from the More (⋮) menu or a mic/camera dropdown. */
const menuItem = async (page, anchor, item) => {
  await page.locator(`[data-testid="${anchor}"]`).click();
  await page.locator(`[data-testid="${item}"]`).click();
};
const openSettings = (page) => menuItem(page, 'ctrl-more', 'ctrl-settings');
/** Count non-background pixels on the whiteboard canvas. */
const inkPixels = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="wb-canvas"]');
    if (!c || !c.width) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200) n++;
    return n;
  });
const drawLine = async (page, from, to) => {
  const box = await page.locator('[data-testid="wb-canvas"]').boundingBox();
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + box.width * (from[0] + ((to[0] - from[0]) * i) / 12), box.y + box.height * (from[1] + ((to[1] - from[1]) * i) / 12));
  }
  await page.mouse.up();
};
const downloadSize = async (dl) => {
  const { statSync } = await import('node:fs');
  return statSync(await dl.path()).size;
};

let A, B;
let clipServer = null;

async function joinMeeting(p, code, name) {
  await p.page.goto(`${BASE}/meeting/${code}`);
  await p.page.locator('[data-testid="name-input"]').fill(name);
  await until(() => p.page.locator('[data-testid="prejoin-video"]').count(), { what: `${name} camera preview` });
  await p.page.locator('[data-testid="join-button"]').click();
  await p.page.locator('[data-testid="call"]').waitFor();
}

async function main() {
  console.log(`Yapameet e2e against ${BASE}`);
  A = await launch(process.env.BROWSER_A || 'chrome', 'A');
  B = await launch(process.env.BROWSER_B || 'msedge', 'B');
  let code = '';

  try {
    await step('Landing page loads, New meeting creates a code + link', async () => {
      await A.page.goto(BASE);
      await A.page.locator('[data-testid="new-meeting"]').click();
      code = (await A.page.locator('[data-testid="new-code"]').innerText()).trim();
      const link = (await A.page.locator('[data-testid="new-link"]').innerText()).trim();
      if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) throw new Error(`bad code ${code}`);
      if (!link.endsWith(`/meeting/${code}`)) throw new Error(`bad link ${link}`);
      return code;
    });

    await step('A starts the meeting (pre-join screen, name, join)', async () => {
      await A.page.locator('[data-testid="start-meeting"]').click();
      await A.page.locator('[data-testid="name-input"]').fill('Alice');
      await until(() => A.page.locator('[data-testid="prejoin-video"]').count(), { what: 'camera preview' });
      await A.page.locator('[data-testid="join-button"]').click();
      await until(async () => (await A.page.locator('[data-testid="signal-status"]').getAttribute('data-status')) === 'connected', {
        what: 'signaling connected',
      });
    });

    await step('B joins through the Join page using the pasted link', async () => {
      await B.page.goto(`${BASE}/join`);
      await B.page.locator('[data-testid="join-code"]').fill(`${BASE}/meeting/${code.toUpperCase()}`);
      await B.page.locator('[data-testid="join-submit"]').click();
      await B.page.waitForURL(`**/meeting/${code}`);
      await B.page.locator('[data-testid="name-input"]').fill('Bob');
      await until(() => B.page.locator('[data-testid="prejoin-video"]').count(), { what: 'camera preview' });
      await B.page.locator('[data-testid="join-button"]').click();
    });

    await step('Both see 2 participants and a connected peer', async () => {
      await until(async () => (await count(A.page)) === 2 && (await count(B.page)) === 2, { what: 'count 2', timeout: 30000 });
      await until(
        async () =>
          (await A.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-conn')) === 'connected' &&
          (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-conn')) === 'connected',
        { what: 'peer connected', timeout: 30000 },
      );
    });

    await step('Camera video flows both ways', async () => {
      const a = await until(() => remoteVideoPlaying(A.page), { what: 'A sees B video' });
      const b = await until(() => remoteVideoPlaying(B.page), { what: 'B sees A video' });
      return `A sees ${a}, B sees ${b}`;
    });

    await step('Microphone audio flows both ways', async () => {
      const a1 = await inbound(A.page);
      const b1 = await inbound(B.page);
      await sleep(2500);
      const a2 = await inbound(A.page);
      const b2 = await inbound(B.page);
      if (!(a2.audioBytes > a1.audioBytes && a2.audioEnergy > a1.audioEnergy)) throw new Error(`A not receiving audio ${JSON.stringify(a2)}`);
      if (!(b2.audioBytes > b1.audioBytes && b2.audioEnergy > b1.audioEnergy)) throw new Error(`B not receiving audio ${JSON.stringify(b2)}`);
      return `level A=${a2.audioLevel.toFixed(3)} B=${b2.audioLevel.toFixed(3)}`;
    });

    await step('Speaking indicator lights for an unmuted remote with audio', async () => {
      await until(() => A.page.locator('[data-testid="tile-remote-cam"].speaking').count(), { what: 'speaking ring', timeout: 10000 });
    });

    await step('Mute: B sees A muted and audio energy stops; unmute restores', async () => {
      await A.page.locator('[data-testid="ctrl-mic"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'off', { what: 'muted state' });
      await sleep(800);
      const m1 = await inbound(B.page);
      await sleep(2000);
      const m2 = await inbound(B.page);
      const mutedEnergy = m2.audioEnergy - m1.audioEnergy;
      if (mutedEnergy > 0.001) throw new Error(`audio energy while muted: ${mutedEnergy}`);
      await A.page.locator('[data-testid="ctrl-mic"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'on', { what: 'unmuted state' });
      await sleep(1500);
      const u1 = await inbound(B.page);
      await sleep(1500);
      const u2 = await inbound(B.page);
      if (!(u2.audioEnergy - u1.audioEnergy > 0.0001)) throw new Error('no audio after unmute');
      return `energy muted=${mutedEnergy.toExponential(1)}, unmuted=${(u2.audioEnergy - u1.audioEnergy).toExponential(1)}`;
    });

    await step('Camera off/on: B sees avatar, then video again; camera track is stopped while off', async () => {
      await A.page.locator('[data-testid="ctrl-cam"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-video')) === 'off', { what: 'video off' });
      const stopped = await A.page.evaluate(() => window.__yapameet.local.cam === null);
      if (!stopped) throw new Error('camera track still live while off');
      await A.page.locator('[data-testid="ctrl-cam"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-video')) === 'on', { what: 'video on' });
      await until(() => remoteVideoPlaying(B.page), { what: 'frames after camera on' });
    });

    await step('Switch camera (A picks second webcam), B keeps receiving video', async () => {
      await openSettings(A.page);
      await A.page.getByRole('tab', { name: 'Video' }).click();
      const options = await A.page.locator('[data-testid="cam-select"] option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent })));
      if (options.length < 2) return `SKIPPED: only ${options.length} camera(s) available`;
      const before = await A.page.evaluate(() => window.__yapameet.local.cam?.getSettings().deviceId);
      const target = options.find((o) => o.v !== before);
      await A.page.locator('[data-testid="cam-select"]').selectOption(target.v);
      await until(async () => (await A.page.evaluate(() => window.__yapameet.local.cam?.getSettings().deviceId)) === target.v, { what: 'new camera active' });
      const sent = await A.page.evaluate(() => {
        const ids = [];
        for (const l of window.__yapameet.links.values()) ids.push(l.pc.getTransceivers()[1].sender.track?.id);
        return ids[0] === window.__yapameet.local.cam.id;
      });
      if (!sent) throw new Error('peer connection still sending the old camera track');
      // Chromium's synthetic "fake_device_1" never feeds an RTP sender (reproducible
      // with a bare RTCPeerConnection loopback, no app code), so prove frames flow
      // after switching back to the first camera through the same replaceTrack path.
      await A.page.locator('[data-testid="cam-select"]').selectOption(before);
      await until(async () => (await A.page.evaluate(() => window.__yapameet.local.cam?.getSettings().deviceId)) === before, { what: 'camera switched back' });
      await until(() => remoteVideoPlaying(B.page), { what: 'frames after switching back' });
      await A.page.keyboard.press('Escape');
      return `${options.length} cameras, switched to "${target.t}" and back, sender track swapped both times`;
    });

    await step('Switch microphone (A picks second mic), B keeps receiving audio', async () => {
      await openSettings(A.page);
      await A.page.getByRole('tab', { name: 'Audio' }).click();
      const options = await A.page.locator('[data-testid="mic-select"] option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent })));
      if (options.length < 2) {
        await A.page.keyboard.press('Escape');
        return `SKIPPED: only ${options.length} microphone(s) available`;
      }
      const before = await A.page.evaluate(() => window.__yapameet.local.mic?.id);
      const curDev = await A.page.evaluate(() => window.__yapameet.local.mic?.getSettings().deviceId);
      const target = options.find((o) => o.v !== curDev) || options[1];
      await A.page.locator('[data-testid="mic-select"]').selectOption(target.v);
      await until(async () => (await A.page.evaluate(() => window.__yapameet.local.mic?.id)) !== before, { what: 'new mic track' });
      const sent = await A.page.evaluate(() => {
        for (const l of window.__yapameet.links.values()) return l.pc.getTransceivers()[0].sender.track?.id === window.__yapameet.local.mic.id;
      });
      if (!sent) throw new Error('peer connection still sending the old mic track');
      await sleep(1500);
      const x1 = await inbound(B.page);
      await sleep(1500);
      const x2 = await inbound(B.page);
      if (!(x2.audioEnergy > x1.audioEnergy)) throw new Error('no audio after mic switch');
      await A.page.keyboard.press('Escape');
      return `${options.length} mics, switched to "${target.t}"`;
    });

    await step('Speaker selection applies setSinkId to call audio', async () => {
      await openSettings(B.page);
      const options = await B.page.locator('[data-testid="speaker-select"] option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
      if (!options.length) {
        await B.page.keyboard.press('Escape');
        return 'SKIPPED: no selectable output devices in this environment';
      }
      const target = options[options.length - 1];
      await B.page.locator('[data-testid="speaker-select"]').selectOption(target);
      await until(() => B.page.evaluate((t) => [...document.querySelectorAll('audio')].some((a) => a.sinkId === t), target), { what: 'sinkId applied' });
      await B.page.keyboard.press('Escape');
      return `${options.length} outputs`;
    });

    await step('Screen sharing: B sees A presenting, then it stops', async () => {
      await A.page.locator('[data-testid="ctrl-screen"]').click();
      const ok = await until(
        async () => {
          if (await A.page.locator('[data-testid="stop-presenting"]').count()) return true;
          return false;
        },
        { what: 'A presenting', timeout: 8000 },
      ).catch(() => false);
      if (!ok) throw new Error('getDisplayMedia did not start (headless capture may be unavailable; run with HEADED=1)');
      const res = await until(() => remoteVideoPlaying(B.page, 'screen'), { what: 'B sees screen video', timeout: 15000 });
      const spotlit = await B.page.locator('.spotlight-main [data-testid="tile-remote-screen"]').count();
      if (!spotlit) throw new Error('screen share not spotlighted');
      await A.page.locator('[data-testid="stop-presenting"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-screen"]').count()) === 0, { what: 'screen tile removed' });
      return `screen ${res}`;
    });

    await step('Chat: message delivery, sender names, unread badge', async () => {
      await A.page.locator('[data-testid="ctrl-chat"]').click();
      await A.page.locator('[data-testid="chat-input"]').fill('hello from Alice https://example.com');
      await A.page.locator('[data-testid="chat-input"]').press('Enter');
      await until(async () => (await B.page.locator('[data-testid="ctrl-chat"] .badge').innerText().catch(() => '')) === '1', { what: 'unread badge on B' });
      await B.page.locator('[data-testid="ctrl-chat"]').click();
      const text = await B.page.locator('[data-testid="chat-msg"]').first().innerText();
      if (!text.includes('Alice') || !text.includes('hello from Alice')) throw new Error(`unexpected chat: ${text}`);
      if (await B.page.locator('[data-testid="ctrl-chat"] .badge').count()) throw new Error('badge not cleared');
      await B.page.locator('[data-testid="chat-input"]').fill('hi Alice, Bob here');
      await B.page.locator('[data-testid="chat-send"]').click();
      await until(async () => (await A.page.locator('[data-testid="chat-msg"]').allInnerTexts()).some((t) => t.includes('Bob here')), { what: 'reply on A' });
      return 'round trip ok';
    });

    await step('Participants panel lists both people', async () => {
      await A.page.locator('[data-testid="ctrl-people"]').click();
      const rows = await A.page.locator('[data-testid="participant-row"]').allInnerTexts();
      if (rows.length !== 2 || !rows.some((r) => r.includes('Bob'))) throw new Error(JSON.stringify(rows));
      await A.page.locator('[data-testid="ctrl-people"]').click();
    });

    await step('Quality: received video reaches HD quickly (start-bitrate fix)', async () => {
      const t0 = Date.now();
      const res = await until(
        async () => {
          const s = await B.page.evaluate(async () => {
            for (const l of window.__yapameet.links.values()) {
              const mid = l.pc.getTransceivers()[1].mid;
              let out = null;
              (await l.pc.getStats()).forEach((r) => {
                if (r.type === 'inbound-rtp' && r.kind === 'video' && r.mid === mid) out = { w: r.frameWidth, h: r.frameHeight, fps: r.framesPerSecond };
              });
              return out;
            }
          });
          return s && s.w >= 1280 ? s : false;
        },
        { what: 'B receiving 720p from A', timeout: 20000 },
      );
      return `${res.w}x${res.h}@${Math.round(res.fps || 0)}fps after ${Date.now() - t0} ms of checking`;
    });

    await step('Stats overlay shows resolution, bitrate, delay and codec', async () => {
      await B.page.evaluate(() => window.__yapameetSettings.update({ showConnectionDetails: true }));
      const text = await until(
        async () => {
          const t = await B.page.locator('[data-testid="tile-stats"]').innerText().catch(() => '');
          return /\d+p/.test(t) && /ms/.test(t) && /(kbps|Mbps)/.test(t) ? t : false;
        },
        { what: 'stats text', timeout: 15000 },
      );
      return text.replace(/\s+/g, ' ');
    });

    const sampleRemote = (page) =>
      page.evaluate(() => {
        const v = document.querySelector('[data-testid="tile-remote-cam"] video');
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 36;
        const g = c.getContext('2d');
        g.drawImage(v, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let sat = 0, r = 0, gg = 0, b = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          sat += mx ? (mx - mn) / mx : 0;
          r += d[i];
          gg += d[i + 1];
          b += d[i + 2];
        }
        return { sat: +(sat / n).toFixed(3), r: Math.round(r / n), g: Math.round(gg / n), b: Math.round(b / n) };
      });

    await step('Effects: blur loads the segmenter, video keeps flowing to B', async () => {
      const before = await A.page.evaluate(() => window.__yapameet.local.cam.id);
      await menuItem(A.page, 'ctrl-cam-menu', 'ctrl-effects');
      await A.page.locator('[data-testid="bg-blur"]').click();
      await until(() => A.page.evaluate(() => !!window.__yapameet.local.pipeline?.segmenterReady), { what: 'segmenter ready', timeout: 30000 });
      const swapped = await A.page.evaluate((before) => {
        const s = window.__yapameet;
        const sent = [...s.links.values()][0].pc.getTransceivers()[1].sender.track?.id;
        return s.local.cam.id !== before && sent === s.local.cam.id;
      }, before);
      if (!swapped) throw new Error('effects track not being sent');
      await until(() => remoteVideoPlaying(B.page), { what: 'B frames with blur' });
      return 'segmentation running, processed track sent';
    });

    await step('Effects: B&W filter actually reaches B (color saturation drops)', async () => {
      await A.page.locator('[data-testid="bg-none"]').click();
      await A.page.locator('[data-testid="filter-none"]').click();
      await sleep(1500);
      const color = await sampleRemote(B.page);
      await A.page.locator('[data-testid="filter-bw"]').click();
      const bw = await until(
        async () => {
          const s = await sampleRemote(B.page);
          return s.sat < 0.05 ? s : false;
        },
        { what: 'grayscale frames on B', timeout: 10000 },
      );
      if (color.sat < 0.1) return `baseline already gray (${color.sat}), filter applied (${bw.sat})`;
      return `saturation ${color.sat} -> ${bw.sat}`;
    });

    await step('Effects: virtual background replaces the scene for B', async () => {
      await A.page.locator('[data-testid="filter-none"]').click();
      await sleep(800);
      const plain = await sampleRemote(B.page);
      await A.page.locator('[data-testid="bg-preset:synthwave"]').click();
      const withBg = await until(
        async () => {
          const s = await sampleRemote(B.page);
          return Math.abs(s.r - plain.r) + Math.abs(s.g - plain.g) + Math.abs(s.b - plain.b) > 40 ? s : false;
        },
        { what: 'scene change on B', timeout: 10000 },
      );
      await A.page.locator('[data-testid="bg-none"]').click();
      await until(() => A.page.evaluate(() => window.__yapameet.local.pipeline === null && window.__yapameet.local.cam === window.__yapameet.local.rawCam), {
        what: 'back to raw camera',
      });
      await A.page.keyboard.press('Escape');
      await until(() => remoteVideoPlaying(B.page), { what: 'frames after effects off' });
      return `avg color ${plain.r},${plain.g},${plain.b} -> ${withBg.r},${withBg.g},${withBg.b}`;
    });

    await step('Reactions float on the other side', async () => {
      await A.page.locator('[data-testid="ctrl-react"]').click();
      await A.page.getByRole('menuitem', { name: 'React 🎉' }).click();
      await until(async () => (await B.page.locator('[data-testid="reaction-float"]').allInnerTexts()).some((t) => t.includes('🎉') && t.includes('Alice')), {
        what: 'reaction on B',
      });
      await A.page.keyboard.press('Escape');
    });

    await step('Raise hand: badge + toast on B, lower removes it', async () => {
      await A.page.locator('[data-testid="ctrl-hand"]').click();
      await until(() => B.page.locator('[data-testid="tile-remote-cam"] [data-testid="hand-badge"]').count(), { what: 'hand badge on B' });
      await A.page.locator('[data-testid="ctrl-hand"]').click();
      await until(async () => (await B.page.locator('[data-testid="hand-badge"]').count()) === 0, { what: 'hand lowered' });
    });

    await step('Muted warning: talking while muted shows a nudge', async () => {
      // Chromium's fake mic plays a constant beep, so A is "talking" while muted.
      await A.page.locator('[data-testid="ctrl-mic"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'off', { what: 'muted' });
      return await until(async () => (await A.page.locator('.toast').allInnerTexts()).find((x) => x.includes("You're muted")), {
        what: 'muted toast',
        timeout: 8000,
      });
    });

    await step('Push to talk: holding Space while muted unmutes for B, release mutes', async () => {
      await A.page.locator('body').click({ position: { x: 5, y: 300 } });
      await A.page.keyboard.down('Space');
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'on', { what: 'PTT on' });
      await A.page.keyboard.up('Space');
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'off', { what: 'PTT off' });
      await A.page.locator('[data-testid="ctrl-mic"]').click();
    });

    await step('Chat commands: /roll and /shrug reach B, /help is local only', async () => {
      if (!(await A.page.locator('[data-testid="chat-input"]').count())) await A.page.locator('[data-testid="ctrl-chat"]').click();
      for (const cmd of ['/help', '/roll 20', '/shrug ok']) {
        await A.page.locator('[data-testid="chat-input"]').fill(cmd);
        await A.page.locator('[data-testid="chat-input"]').press('Enter');
      }
      await until(() => A.page.locator('[data-testid="chat-note"]').count(), { what: 'help note' });
      const got = await until(
        async () => {
          const texts = await B.page.evaluate(() => window.__yapameet.getSnapshot().messages.map((m) => m.text));
          return texts.some((t) => /rolled \d+ \(1-20\)/.test(t)) && texts.some((t) => t.includes('ok ¯\\_(ツ)_/¯')) ? texts : false;
        },
        { what: 'commands on B' },
      );
      if (got.some((t) => t.startsWith('Commands:'))) throw new Error('/help leaked to B');
    });

    await step('Easter eggs: /party and "do a barrel roll" hit both screens', async () => {
      await A.page.locator('[data-testid="chat-input"]').fill('/party');
      await A.page.locator('[data-testid="chat-input"]').press('Enter');
      await until(() => B.page.evaluate(() => document.documentElement.classList.contains('fx-party')), { what: 'party on B' });
      await A.page.locator('[data-testid="chat-input"]').fill('do a barrel roll!');
      await A.page.locator('[data-testid="chat-input"]').press('Enter');
      await until(() => B.page.evaluate(() => document.documentElement.classList.contains('fx-barrelroll')), { what: 'barrel roll on B', interval: 50 });
      const eggs = await A.page.evaluate(() => window.__yapameetSettings.get().eggs);
      if (!eggs.includes('party') || !eggs.includes('barrelroll')) throw new Error(`eggs ${eggs}`);
      await A.page.locator('[data-testid="ctrl-chat"]').click();
    });

    await step('Easter egg: Konami code unlocks the Arcade theme', async () => {
      await A.page.locator('body').click({ position: { x: 5, y: 300 } });
      for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
        await A.page.keyboard.press(k);
      }
      await until(() => A.page.evaluate(() => document.documentElement.dataset.theme === 'arcade'), { what: 'arcade theme' });
      await A.page.evaluate(() => window.__yapameetSettings.update({ theme: 'midnight' }));
    });

    await step('Soundboard: built-in pad is heard by B even while A is muted', async () => {
      await A.page.locator('[data-testid="ctrl-mic"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'off', { what: 'muted' });
      await openTools(A.page, 'soundboard');
      const e0 = await boardEnergy(B.page);
      await A.page.locator('[data-testid="pad-builtin:airhorn"]').click();
      const e1 = await until(async () => {
        const e = await boardEnergy(B.page);
        return e - e0 > 0.01 ? e : false;
      }, { what: 'soundboard audio on B', timeout: 8000 });
      await A.page.locator('[data-testid="ctrl-mic"]').click();
      return `energy +${(e1 - e0).toFixed(3)} on the soundboard channel`;
    });

    await step('Soundboard: upload an audio file, it becomes a pad and plays for B', async () => {
      await A.page.locator('[data-testid="sound-file"]').setInputFiles({ name: 'honk.wav', mimeType: 'audio/wav', buffer: makeWav() });
      const pad = A.page.locator('[data-testid^="pad-custom:"]').filter({ hasText: 'honk' });
      await pad.waitFor({ timeout: 8000 });
      await sleep(2500);
      const e0 = await boardEnergy(B.page);
      await pad.click();
      await until(async () => (await boardEnergy(B.page)) - e0 > 0.01, { what: 'uploaded sound on B', timeout: 8000 });
      return 'honk.wav uploaded, stored and played';
    });

    await step('Tools: fun buttons trigger effects on both screens', async () => {
      await openTools(A.page, 'fun');
      await A.page.locator('[data-testid="tool-barrelroll"]').click();
      await until(() => B.page.evaluate(() => document.documentElement.classList.contains('fx-barrelroll')), { what: 'barrel roll on B', interval: 50 });
      await A.page.locator('[data-testid="tool-dice"]').click();
      await until(() => B.page.evaluate(() => window.__yapameet.getSnapshot().messages.some((m) => m.text.startsWith('🎲 rolled'))), { what: 'dice on B' });
      await closeSide(A.page);
    });

    await step('Chat: typing indicator and new-message preview bubble', async () => {
      if (await B.page.locator('[data-testid="chat-input"]').count()) await B.page.locator('[data-testid="ctrl-chat"]').click();
      if (!(await A.page.locator('[data-testid="chat-input"]').count())) await A.page.locator('[data-testid="ctrl-chat"]').click();
      await A.page.locator('[data-testid="chat-input"]').fill('preview me');
      await A.page.locator('[data-testid="chat-input"]').press('Enter');
      await until(async () => (await B.page.locator('[data-testid="chat-preview"]').innerText().catch(() => '')).includes('preview me'), { what: 'preview bubble on B' });
      await B.page.locator('[data-testid="chat-preview"]').click();
      await B.page.locator('[data-testid="chat-input"]').waitFor();
      await A.page.locator('[data-testid="chat-input"]').pressSequentially('typing now', { delay: 30 });
      await until(async () => (await B.page.locator('[data-testid="typing-line"]').innerText()).includes('Alice is typing'), { what: 'typing indicator on B' });
      await A.page.locator('[data-testid="chat-input"]').fill('');
      await A.page.locator('[data-testid="ctrl-chat"]').click();
      await B.page.locator('[data-testid="ctrl-chat"]').click();
    });

    await step('Mini player: opens a floating window with the call, its buttons control the call', async () => {
      const supported = await A.page.evaluate(() => 'documentPictureInPicture' in window);
      if (!supported) return 'SKIPPED: Document Picture-in-Picture not available in this browser mode';
      await menuItem(A.page, 'ctrl-more', 'ctrl-mini');
      await until(() => A.page.evaluate(() => !!window.documentPictureInPicture.window?.document.querySelector('[data-testid="mini-player"]')), { what: 'mini player window' });
      const frames = await until(
        () =>
          A.page.evaluate(async () => {
            const v = window.documentPictureInPicture.window.document.querySelector('.mini-tile video');
            if (!v || !v.videoWidth) return false;
            let n = 0;
            await new Promise((res) => {
              const cb = () => {
                n++;
                v.requestVideoFrameCallback(cb);
              };
              v.requestVideoFrameCallback(cb);
              setTimeout(res, 700);
            });
            return n >= 2 ? `${v.videoWidth}x${v.videoHeight}` : false;
          }),
        { what: 'video playing in mini player' },
      );
      await A.page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[data-testid="mini-mic"]').click());
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'off', { what: 'muted from mini player' });
      await A.page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[data-testid="mini-mic"]').click());
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-audio')) === 'on', { what: 'unmuted from mini player' });
      await A.page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[data-testid="mini-back"]').click());
      await until(() => A.page.evaluate(() => !window.documentPictureInPicture.window), { what: 'mini player closed' });
      return `remote video ${frames} in the mini player; mute/unmute from inside it reached B`;
    });

    await step('Signal bars show connection quality on remote tiles', async () => {
      const q = await until(async () => Number(await A.page.locator('[data-testid="net-bars"]').getAttribute('data-quality').catch(() => 0)), {
        what: 'quality bars on A',
        timeout: 10000,
      });
      if (q < 3) throw new Error(`quality ${q} on a local connection`);
      return `${q}/4 bars`;
    });

    await step('Whiteboard: A draws, B gets notified and sees the ink; clear wipes it for both', async () => {
      await openTools(A.page, 'whiteboard');
      await A.page.locator('[data-testid="wb-canvas"]').waitFor();
      await drawLine(A.page, [0.2, 0.3], [0.7, 0.6]);
      await B.page.locator('[data-testid="activity-card"]').filter({ hasText: 'whiteboard' }).click({ timeout: 10000 });
      await B.page.locator('[data-testid="wb-canvas"]').waitFor();
      const ink = await until(async () => {
        const n = await inkPixels(B.page);
        return n > 30 ? n : false;
      }, { what: 'ink on B' });
      await A.page.locator('[data-testid="wb-clear"]').click();
      await until(async () => (await inkPixels(B.page)) === 0, { what: 'board cleared on B' });
      await drawLine(A.page, [0.3, 0.7], [0.8, 0.2]);
      await until(async () => (await inkPixels(B.page)) > 30, { what: 'second stroke on B' });
      await B.page.locator('[data-testid="wb-close"]').click();
      await A.page.locator('[data-testid="wb-close"]').click();
      return `${ink} ink samples on B`;
    });

    await step('Polls: A launches a poll, B votes from the notification, A sees the result', async () => {
      await openTools(A.page, 'polls');
      await A.page.locator('[data-testid="poll-question"]').fill('Pizza or tacos?');
      await A.page.locator('[data-testid="poll-option-0"]').fill('Pizza');
      await A.page.locator('[data-testid="poll-option-1"]').fill('Tacos');
      await A.page.locator('[data-testid="poll-launch"]').click();
      await B.page.locator('[data-testid="activity-card"]').filter({ hasText: 'Pizza or tacos?' }).click({ timeout: 10000 });
      await B.page.locator('[data-testid="polls-panel"] [data-testid="poll-vote-1"]').click();
      await until(async () => (await A.page.locator('[data-testid="poll-count-1"]').innerText()).startsWith('1 ·'), { what: 'vote counted on A' });
      const txt = await A.page.locator('[data-testid="poll-count-1"]').innerText();
      await closeSide(A.page);
      await closeSide(B.page);
      return `Tacos: ${txt}`;
    });

    await step('Shared timer: A starts 1 minute, B sees the countdown, stop clears it', async () => {
      await openTools(A.page, 'timer');
      await A.page.locator('[data-testid="timer-1"]').click();
      const t = await until(async () => {
        const x = await B.page.locator('[data-testid="timer-chip"]').innerText().catch(() => '');
        return /0:5\d|1:00/.test(x) ? x.trim() : false;
      }, { what: 'timer on B' });
      await A.page.locator('[data-testid="timer-stop"]').click();
      await until(async () => (await B.page.locator('[data-testid="timer-chip"]').count()) === 0, { what: 'timer stopped on B' });
      return `B showed ${t}`;
    });

    await step('Live captions: B turns on captions, A is asked to transcribe, captions show on B', async () => {
      const supported = await B.page.locator('[data-testid="ctrl-cc"]').count();
      if (!supported) return 'SKIPPED: speech recognition API not present in this browser';
      await B.page.locator('[data-testid="ctrl-cc"]').click();
      await until(() => A.page.evaluate(() => window.__yapameet.anyoneWantsCaptions()), { what: 'A knows captions are wanted' });
      // Headless browsers can't reach the speech service, so inject a caption as A's recognizer would.
      await A.page.evaluate(() => window.__yapameet.sendApp('cc', { id: 't1', text: 'hello from the captions test', final: true }));
      await until(async () => (await B.page.locator('[data-testid="captions-overlay"]').innerText().catch(() => '')).includes('Alice: hello from the captions test'), {
        what: 'caption on B',
      });
      await B.page.locator('[data-testid="ctrl-cc"]').click();
      await until(() => A.page.evaluate(() => !window.__yapameet.anyoneWantsCaptions()), { what: 'captions off everywhere' });
      return 'caption delivered and shown with speaker name';
    });

    await step('Recording: B sees REC while A records; stopping saves a video file', async () => {
      await openTools(A.page, 'capture');
      await A.page.locator('[data-testid="tool-record"]').click();
      await B.page.locator('[data-testid="rec-chip"]').waitFor({ timeout: 10000 });
      await until(() => B.page.locator('[data-testid="tile-remote-cam"] .tile-rec').count(), { what: 'REC badge on tile' });
      await sleep(3000);
      const [dl] = await Promise.all([A.page.waitForEvent('download', { timeout: 15000 }), A.page.locator('[data-testid="tool-record"]').click()]);
      const size = await downloadSize(dl);
      if (size < 20_000) throw new Error(`recording only ${size} bytes`);
      await until(async () => (await B.page.locator('[data-testid="rec-chip"]').count()) === 0, { what: 'REC cleared on B' });
      return `${dl.suggestedFilename()} ${Math.round(size / 1024)} KB`;
    });

    await step('Group photo downloads a PNG of the call', async () => {
      const [dl] = await Promise.all([A.page.waitForEvent('download', { timeout: 10000 }), A.page.locator('[data-testid="tool-photo"]').click()]);
      const size = await downloadSize(dl);
      if (!dl.suggestedFilename().endsWith('.png') || size < 20_000) throw new Error(`${dl.suggestedFilename()} ${size}`);
      return `${Math.round(size / 1024)} KB`;
    });

    await step('Voice changer: robot and chipmunk replace the sent mic track, B still hears audio', async () => {
      const results = [];
      await openTools(A.page, 'voice');
      for (const v of ['robot', 'chipmunk', 'cave']) {
        await A.page.locator(`[data-testid="voice-${v}"]`).click();
        await until(
          () =>
            A.page.evaluate(() => {
              const s = window.__yapameet;
              const sent = [...s.links.values()][0].pc.getTransceivers()[0].sender.track;
              return sent && sent.id !== s.local.mic.id && sent.id === s.local.micOut.id;
            }),
          { what: `${v} track sent` },
        );
        await sleep(1200);
        const e0 = (await inbound(B.page)).audioEnergy;
        await sleep(1500);
        const e1 = (await inbound(B.page)).audioEnergy;
        if (!(e1 - e0 > 0.0005)) throw new Error(`no audio with ${v}`);
        results.push(`${v} +${(e1 - e0).toFixed(3)}`);
      }
      await A.page.locator('[data-testid="voice-none"]').click();
      await until(
        () => A.page.evaluate(() => [...window.__yapameet.links.values()][0].pc.getTransceivers()[0].sender.track?.id === window.__yapameet.local.mic.id),
        { what: 'raw mic restored' },
      );
      await closeSide(A.page);
      return results.join(', ');
    });

    await step('Auto-framing runs the segmenter and keeps video flowing', async () => {
      await A.page.evaluate(() => window.__yapameetSettings.update({ autoFrame: true }));
      await until(() => A.page.evaluate(() => !!window.__yapameet.local.pipeline?.segmenterReady), { what: 'segmenter for framing' });
      await until(() => remoteVideoPlaying(B.page), { what: 'frames with auto-framing' });
      await A.page.evaluate(() => window.__yapameetSettings.update({ autoFrame: false }));
      await until(() => A.page.evaluate(() => window.__yapameet.local.pipeline === null), { what: 'pipeline off' });
    });

    await step('"?" opens the keyboard shortcuts sheet', async () => {
      await A.page.locator('body').click({ position: { x: 5, y: 300 } });
      await A.page.keyboard.press('Shift+Slash');
      await A.page.locator('[data-testid="shortcuts"]').waitFor({ timeout: 5000 });
      await A.page.keyboard.press('Escape');
    });

    await step('Organised controls: More menu, camera menu quick blur, tabbed side panel', async () => {
      await A.page.locator('[data-testid="ctrl-more"]').click();
      const items = await A.page.locator('[data-testid="more-menu"] .menu-item').count();
      await A.page.keyboard.press('Escape');
      await menuItem(A.page, 'ctrl-cam-menu', 'menu-blur');
      await until(() => A.page.evaluate(() => window.__yapameetSettings.get().bgEffect === 'blur'), { what: 'blur via camera menu' });
      await menuItem(A.page, 'ctrl-cam-menu', 'menu-blur');
      await until(() => A.page.evaluate(() => window.__yapameetSettings.get().bgEffect === 'none'), { what: 'blur off' });
      await A.page.locator('[data-testid="ctrl-people"]').click();
      await A.page.locator('[data-testid="side-tab-chat"]').click();
      await A.page.locator('[data-testid="chat-input"]').waitFor();
      await A.page.locator('[data-testid="side-tab-activities"]').click();
      await A.page.locator('[data-testid="side-tab-activities"]').click();
      await A.page.locator('[data-testid="act-watch"]').waitFor();
      await closeSide(A.page);
      return `${items} items in More, tabs People/Chat/Activities switch in one panel`;
    });

    await step('Watch together: A plays a video link, B gets the synced player', async () => {
      await ensureClip(A.page);
      clipServer = await serveClip();
      await openTools(A.page, 'watch');
      await A.page.locator('[data-testid="watch-url"]').fill('http://localhost:8779/clip.webm');
      await A.page.locator('[data-testid="watch-start"]').click();
      await A.page.locator('[data-testid="watch-video"]').waitFor();
      await B.page.locator('[data-testid="watch-video"]').waitFor({ timeout: 15000 });
      await until(async () => {
        const a = await videoTime(A.page);
        const b = await videoTime(B.page);
        return a && b && !a.paused && !b.paused && a.t > 1.5 && Math.abs(a.t - b.t) < 0.8;
      }, { what: 'both playing in sync', timeout: 20000 });
      const a = await videoTime(A.page);
      const b = await videoTime(B.page);
      await closeSide(A.page);
      return `A ${a.t.toFixed(2)}s, B ${b.t.toFixed(2)}s`;
    });

    await step('Watch together: pause and seek on one side apply to the other', async () => {
      await B.page.evaluate(() => document.querySelector('[data-testid="watch-video"]').pause());
      await until(async () => (await videoTime(A.page))?.paused, { what: 'A paused by B' });
      await A.page.evaluate(() => {
        const v = document.querySelector('[data-testid="watch-video"]');
        v.currentTime = 2;
        v.play();
      });
      await until(async () => {
        const b = await videoTime(B.page);
        const a = await videoTime(A.page);
        return b && a && !b.paused && Math.abs(b.t - a.t) < 0.8 && a.t < 10;
      }, { what: 'B followed seek + play', timeout: 15000 }).catch(async (e) => {
        const ws = (p) => p.evaluate(() => { const v = document.querySelector('[data-testid="watch-video"]'); const w = window.__yapameetWatch; return JSON.stringify({ v: v && [v.currentTime.toFixed(2), v.paused, v.ended, v.readyState, v.duration], store: w && [w.expectedPos().toFixed(2), w.playing, w.leading, w.src?.url] }); });
        console.log('    A:', await ws(A.page));
        console.log('    B:', await ws(B.page));
        throw e;
      });
      const a = await videoTime(A.page);
      const b = await videoTime(B.page);
      return `after seek: A ${a.t.toFixed(2)}s, B ${b.t.toFixed(2)}s`;
    });

    await step('Watch together: YouTube links load the synced YouTube player for everyone', async () => {
      await openTools(A.page, 'watch');
      await A.page.locator('[data-testid="watch-url"]').fill('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
      await A.page.locator('[data-testid="watch-start"]').click();
      await B.page.locator('[data-testid="watch-view"][data-kind="youtube"]').waitFor({ timeout: 15000 });
      const iframe = await until(() => B.page.locator('[data-testid="watch-youtube"] iframe').count(), { what: 'YouTube iframe on B', timeout: 15000 }).catch(() => 0);
      await A.page.locator('[data-testid="watch-stop"]').click();
      await until(async () => (await B.page.locator('[data-testid="watch-view"]').count()) === 0, { what: 'stopped for B' });
      await closeSide(A.page);
      return iframe ? 'YouTube player embedded on B, stop closed it for both' : 'B switched to the YouTube player (iframe API unreachable in this test browser), stop closed it';
    });

    await step('Hear myself: plays your own voice back locally', async () => {
      await openTools(A.page, 'voice');
      await A.page.locator('[data-testid="hear-myself"]').click();
      const on = await A.page.evaluate(() => window.__yapameet.local.hearMyself);
      await A.page.locator('[data-testid="hear-myself"]').click();
      const off = await A.page.evaluate(() => window.__yapameet.local.hearMyself);
      await closeSide(A.page);
      if (!on || off) throw new Error(`on=${on} off=${off}`);
    });

    await step('Swear filter: censors chat for B, and B can turn it off', async () => {
      if (!(await A.page.locator('[data-testid="chat-input"]').count())) await A.page.locator('[data-testid="ctrl-chat"]').click();
      await A.page.locator('[data-testid="chat-input"]').fill('well that was shit, f*ck');
      await A.page.locator('[data-testid="chat-input"]').press('Enter');
      if (!(await B.page.locator('[data-testid="chat-input"]').count())) await B.page.locator('[data-testid="ctrl-chat"]').click();
      const shown = await until(async () => {
        const t = await B.page.locator('[data-testid="chat-msg"]').last().innerText();
        return t.includes('well that was') ? t : false;
      }, { what: 'message on B' });
      if (/shit|f\*ck/.test(shown) || !shown.includes('s***')) throw new Error(`not censored: ${shown}`);
      await B.page.evaluate(() => window.__yapameetSettings.update({ censorSwears: false }));
      await B.page.locator('[data-testid="side-tab-people"]').click();
      await B.page.locator('[data-testid="side-tab-chat"]').click();
      const raw = await B.page.locator('[data-testid="chat-msg"]').last().innerText();
      await B.page.evaluate(() => window.__yapameetSettings.update({ censorSwears: true }));
      await closeSide(A.page);
      await closeSide(B.page);
      if (!raw.includes('shit')) throw new Error('filter off did not show original');
      return `B saw "${shown.split('\n').pop()}"`;
    });

    await step('Profile pictures: A sets an emoji picture; B sees it on the tile (camera off), in People and in chat', async () => {
      await openSettings(A.page);
      await A.page.getByRole('tab', { name: 'Profile' }).click();
      await A.page.locator('[data-testid="pfp-emoji-mode"]').click();
      await A.page.locator('[data-testid="pfp-emoji-save"]').click();
      await A.page.keyboard.press('Escape');
      await A.page.locator('[data-testid="ctrl-cam"]').click();
      const src = await until(
        () => B.page.locator('[data-testid="tile-remote-cam"] img.avatar-img').getAttribute('src').catch(() => null),
        { what: 'picture on B tile', timeout: 10000 },
      );
      if (!src.startsWith('data:image/')) throw new Error('unexpected picture ' + src.slice(0, 30));
      await B.page.locator('[data-testid="ctrl-people"]').click();
      await until(() => B.page.locator('[data-testid="participant-row"] img.avatar-img').count(), { what: 'picture in People on B' });
      if (!(await A.page.locator('[data-testid="chat-input"]').count())) await A.page.locator('[data-testid="ctrl-chat"]').click();
      await A.page.locator('[data-testid="chat-input"]').fill('picture check');
      await A.page.locator('[data-testid="chat-input"]').press('Enter');
      await B.page.locator('[data-testid="side-tab-chat"]').click();
      // Messages are grouped per sender; the picture sits at the start of each group.
      await until(() => B.page.locator('[data-testid="chat-msg"] .chat-meta img.avatar-img').count(), { what: 'picture next to chat messages on B' });
      await closeSide(A.page);
      await closeSide(B.page);
      return `${Math.round(src.length / 1024)} KB picture delivered peer-to-peer`;
    });

    await step('Profile pictures: upload a photo, then remove it (B falls back to initials)', async () => {
      const png = Buffer.from(
        await A.page.evaluate(() => {
          const cv = document.createElement('canvas');
          cv.width = cv.height = 64;
          const g = cv.getContext('2d');
          g.fillStyle = '#e11d48';
          g.fillRect(0, 0, 64, 64);
          g.fillStyle = '#fde047';
          g.fillRect(16, 16, 32, 32);
          return cv.toDataURL('image/png').split(',')[1];
        }),
        'base64',
      );
      try {
      await openSettings(A.page);
      await A.page.getByRole('tab', { name: 'Profile' }).click();
      await A.page.locator('[data-testid="pfp-file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
      await until(async () => ((await B.page.locator('[data-testid="tile-remote-cam"] img.avatar-img').getAttribute('src').catch(() => '')) || '').startsWith('data:image/jpeg'), {
        what: 'uploaded photo on B',
      });
      await A.page.locator('[data-testid="pfp-remove"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"] img.avatar-img').count()) === 0, { what: 'initials on B after remove' });
      await A.page.locator('[data-testid="pfp-emoji-mode"]').click();
      await A.page.locator('[data-testid="pfp-emoji-save"]').click();
      } finally {
        // Always leave A with the dialog closed and the camera on, so later tests aren't affected.
        await A.page.keyboard.press('Escape');
        if ((await A.page.locator('[data-testid="ctrl-cam"]').getAttribute('aria-label')).includes('on')) await A.page.locator('[data-testid="ctrl-cam"]').click();
        await until(() => remoteVideoPlaying(B.page), { what: 'camera back on' });
      }
      return 'upload (JPEG) and remove both reached B';
    });

    await step('Leave: A sees B leave quickly; Rejoin reconnects', async () => {
      const t0 = Date.now();
      await B.page.locator('[data-testid="ctrl-leave"]').click();
      await until(async () => (await count(A.page)) === 1, { what: 'A count back to 1', timeout: 15000 });
      const leftMs = Date.now() - t0;
      const camReleased = await B.page.evaluate(() => !document.querySelector('video'));
      await B.page.locator('[data-testid="rejoin"]').click();
      await until(() => B.page.locator('[data-testid="prejoin-video"]').count(), { what: 'preview again' });
      await B.page.locator('[data-testid="join-button"]').click();
      await until(async () => (await count(A.page)) === 2, { what: 'A count 2 after rejoin', timeout: 30000 });
      await until(() => remoteVideoPlaying(A.page), { what: 'video after rejoin', timeout: 30000 });
      return `leave noticed in ${leftMs} ms, devices released=${camReleased}`;
    });

    await step('Whiteboard: a rejoining person receives the existing board', async () => {
      await openTools(B.page, 'whiteboard');
      const n = await until(async () => {
        const x = await inkPixels(B.page);
        return x > 30 ? x : false;
      }, { what: 'board snapshot on rejoined B' });
      await B.page.locator('[data-testid="wb-close"]').click();
      return `${n} ink samples restored`;
    });

    await step('Profile pictures: a rejoining person receives existing pictures', async () => {
      const got = await until(
        () => B.page.evaluate(() => window.__yapameet.getSnapshot().participants.slice(1).some((p) => p.pfp && p.pfp.startsWith('data:image/'))),
        { what: "A's picture on rejoined B" },
      );
      return got ? 'delivered on reconnect' : '';
    });

    await step('Reload: B refreshes the tab; A replaces the old connection (no duplicate)', async () => {
      await B.page.reload();
      await B.page.locator('[data-testid="join-button"]').click();
      await until(() => remoteVideoPlaying(A.page), { what: 'video after reload', timeout: 30000 });
      await sleep(3000);
      const c = await count(A.page);
      const tiles = await A.page.locator('[data-testid="tile-remote-cam"]').count();
      if (c !== 2 || tiles !== 1) throw new Error(`count=${c} remoteTiles=${tiles}`);
    });

    await step('Recovery: B link killed abruptly; both sides rebuild the connection', () => withDump(async () => {
      await B.page.evaluate(() => {
        for (const l of window.__yapameet.links.values()) l.pc.close(); // dies silently, no events
      });
      await sleep(1000);
      await until(() => remoteVideoPlaying(B.page), { what: 'B video recovered', timeout: 45000 });
      await until(() => remoteVideoPlaying(A.page), { what: 'A video recovered', timeout: 45000 });
    }));

    await step('Recovery: A link killed abruptly; both sides rebuild the connection', () => withDump(async () => {
      await A.page.evaluate(() => {
        for (const l of window.__yapameet.links.values()) l.pc.close();
      });
      await sleep(1000);
      await until(() => remoteVideoPlaying(A.page), { what: 'A video recovered', timeout: 45000 });
      await until(() => remoteVideoPlaying(B.page), { what: 'B video recovered', timeout: 45000 });
    }));

    await step('Recovery: ICE restart keeps media flowing', () => withDump(async () => {
      await A.page.evaluate(() => {
        const s = window.__yapameet;
        for (const l of s.links.values()) s.restart(l);
      });
      await sleep(3000);
      await until(() => remoteVideoPlaying(B.page), { what: 'B video after ICE restart' });
      await until(() => remoteVideoPlaying(A.page), { what: 'A video after ICE restart' });
    }));

    await step('Signaling drop: B loses its relay connection, chat typed while offline is delivered after reconnect', async () => {
      if (!(await B.page.locator('[data-testid="chat-input"]').count())) await B.page.locator('[data-testid="ctrl-chat"]').click();
      await B.page.evaluate(() => {
        const t = window.__yapameet.signal.transport;
        for (const c of t.clients || []) c.stream?.destroy?.();
        if (t.client?.realtime) t.client.realtime.conn?.close();
      });
      await until(async () => (await B.page.locator('[data-testid="signal-status"]').getAttribute('data-status')) !== 'connected', {
        what: 'B notices the drop',
        timeout: 10000,
        interval: 50,
      });
      await B.page.locator('[data-testid="chat-input"]').fill('sent while offline');
      await B.page.locator('[data-testid="chat-send"]').click();
      await until(async () => (await B.page.locator('[data-testid="signal-status"]').getAttribute('data-status')) === 'connected', {
        what: 'B signaling back',
        timeout: 30000,
      });
      await until(() => A.page.evaluate(() => window.__yapameet.getSnapshot().messages.some((m) => m.text === 'sent while offline')), {
        what: 'offline chat delivered',
      });
      await until(async () => (await A.page.locator('[data-testid="ctrl-chat"] .badge').innerText().catch(() => '')) !== '', { what: 'unread badge on A' });
      await until(() => remoteVideoPlaying(A.page), { what: 'media unaffected' });
    });

    await step('Third participant (mesh): everyone connects to everyone', async () => {
      const C = await launch(process.env.BROWSER_A || 'chrome', 'C');
      try {
        await joinMeeting(C, code, 'Carol');
        for (const p of [A.page, B.page, C.page]) {
          await until(async () => (await count(p)) === 3, { what: 'count 3', timeout: 30000 });
        }
        for (const p of [A.page, B.page, C.page]) {
          await until(
            async () => {
              const conns = await p.locator('[data-testid="tile-remote-cam"]').evaluateAll((els) => els.map((e) => e.dataset.conn));
              return conns.length === 2 && conns.every((c) => c === 'connected');
            },
            { what: 'all mesh links connected', timeout: 30000 },
          );
        }
        await C.page.locator('[data-testid="ctrl-leave"]').click();
        await until(async () => (await count(A.page)) === 2, { what: 'back to 2' });
      } finally {
        await C.browser.close();
      }
    });

    await step('Ghost Protocol: triple-click logo, capture empty room, B receives the photo', async () => {
      const logo = A.page.locator('[data-testid="call-logo"]');
      await logo.click();
      await logo.click();
      await logo.click();
      await A.page.locator('[data-testid="ghost-dialog"]').waitFor();
      await A.page.locator('[data-testid="ghost-start"]').click();
      await A.page.locator('[data-testid="ghost-done"]').waitFor({ timeout: 12000 });
      await A.page.locator('[data-testid="ghost-done"]').click();
      const size = await until(
        () =>
          B.page.evaluate(() => {
            const l = [...window.__yapameet.links.values()][0];
            return l?.roomPhoto?.length || 0;
          }),
        { what: 'room photo on B' },
      );
      return `photo ${Math.round(size / 1024)} KB delivered peer-to-peer`;
    });

    await step('Ghost Protocol: when A leaves, B sees A fade into the empty room, then the tile goes', async () => {
      await A.page.locator('[data-testid="ctrl-leave"]').click();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').getAttribute('data-leaving')) === 'ghost', {
        what: 'ghost tile on B',
        interval: 50,
      });
      const hasRoom = await B.page.locator('[data-testid="tile-remote-cam"] .ghost-room').count();
      const fading = await B.page.locator('[data-testid="tile-remote-cam"] .ghost-freeze.fading').count();
      if (!hasRoom || !fading) throw new Error(`room=${hasRoom} fading=${fading}`);
      const t0 = Date.now();
      await until(async () => (await B.page.locator('[data-testid="tile-remote-cam"]').count()) === 0, { what: 'tile removed', timeout: 10000 });
      return `fade ran ${Date.now() - t0} ms`;
    });

    await step('Leaving cleans up peer connections and tracks', async () => {
      await A.page.locator('[data-testid="rejoin"]').waitFor();
      const leak = await A.page.evaluate(() => ({ session: !!window.__yapameet, videos: document.querySelectorAll('video').length }));
      if (leak.session || leak.videos) throw new Error(JSON.stringify(leak));
      await until(async () => (await count(B.page)) === 1, { what: 'B sees A leave' });
    });
  } finally {
    await A.browser.close();
    await B.browser.close();
    clipServer?.close();
  }

  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
