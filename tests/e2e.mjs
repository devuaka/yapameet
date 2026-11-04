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
  await context.grantPermissions(['camera', 'microphone'], { origin: BASE });
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

let A, B;

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
      await A.page.locator('[data-testid="ctrl-settings"]').click();
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
      await A.page.locator('[data-testid="ctrl-settings"]').click();
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
      await B.page.locator('[data-testid="ctrl-settings"]').click();
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

    await step('Leaving cleans up peer connections and tracks', async () => {
      await A.page.locator('[data-testid="ctrl-leave"]').click();
      await A.page.locator('[data-testid="rejoin"]').waitFor();
      const leak = await A.page.evaluate(() => ({ session: !!window.__yapameet, videos: document.querySelectorAll('video').length }));
      if (leak.session || leak.videos) throw new Error(JSON.stringify(leak));
      await until(async () => (await count(B.page)) === 1, { what: 'B sees A leave' });
    });
  } finally {
    await A.browser.close();
    await B.browser.close();
  }

  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
