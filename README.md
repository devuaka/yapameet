# Yapameet

Free, browser-based video meetings. Create a link, send it, talk. No accounts, no installs, and no servers you pay for.

- Video and audio over **WebRTC**, sent peer-to-peer and encrypted (DTLS-SRTP)
- Mute/unmute, camera on/off, camera / microphone / speaker selection, noise suppression, echo cancellation, auto gain
- Screen sharing (tab, window or full screen), with tab or system audio where the browser supports it
- Live chat with names, timestamps, unread badge and clickable links
- Speaking indicators, per-person connection status (direct vs relayed, round-trip time)
- Join/leave/message sounds, fullscreen (whole call or a single tile), picture-in-picture, pin a tile
- Layout that adapts: 1-on-1 with a floating self view, a grid sized to fit, spotlight for screen shares
- Pre-join screen with camera preview, mic level meter and device pickers
- Automatic recovery: ICE restarts, rebuilding broken connections, rejoin after reload without duplicates
- Responsive on desktop, tablet and phone; keyboard shortcuts Ctrl+D (mic) and Ctrl+E (camera)
- **Quality presets** up to 1080p60, codec choice (VP8/VP9/H.264/AV1), low-latency mode, live per-tile stats (resolution, fps, bitrate, delay, codec)
- **Background blur / replacement** (8 built-in scenes + your own uploads) and **12 filters** plus low-light boost. Runs on your device with MediaPipe selfie segmentation; your real background is never sent while effects load
- **11 themes** (2 secret), reduce-motion, compact tiles, layout modes (auto / grid / active speaker), hide self view
- **Reactions**, **raise hand**, **push to talk** (hold Space while muted), "you're muted" warning
- **Soundboard**: 8 built-in synthesized sounds + upload your own MP3/WAV/OGG/M4A (stored on your device). Everyone hears them, even while you're muted
- **Mini player**: switch tabs during a call and Chrome/Edge pop out a floating window with the call and your controls (Document Picture-in-Picture + Media Session auto-PiP, like Meet); there's also a manual button
- **Games** (Activities > Games): Draw & Guess (Pictionary-style on the shared whiteboard, private guessing, scores), Spin the wheel, Rock Paper Scissors duels, Would You Rather
- **Throw stuff** at people: hover a video, hit 🍅 (tomato, egg, pie, slime, snowball, shoe, hearts, flowers) and it splats on their tile for everyone
- **Face stickers**: shades, crown, top hat, party hat, clown nose, cat ears, devil horns, halo, heart eyes, mustache; tracked to your face (MediaPipe) so everyone sees them
- **Watch together**: paste a YouTube link or a catbox.moe / litterbox (or any direct .mp4/.webm) link; play, pause and seeking are synced for everyone, drift is corrected automatically, the end of the video stops everyone, late joiners jump in at the right spot
- **Swear filter** (on by default, per person) for chat, captions, polls and transcripts. Live voice can't be filtered: speech recognition only knows a word after everyone heard it
- **Hear myself** toggle for the voice changer (use headphones)
- **Organised call screen**: Mic ▾ and Camera ▾ dropdowns (devices, speakers, quick blur, auto-framing, voice changer), a ⋮ More menu for everything else, and one side panel with People / Chat / Activities tabs; Activities is a launcher where every tool has its own page
- **Collaborative whiteboard** (pen, highlighter, eraser, colors, undo, clear, save as PNG); people who join late get the current board
- **Polls** with live results (named or anonymous) and a **shared countdown timer**
- **Live captions** with speaker names and a downloadable transcript (each person's own browser transcribes their own mic; Chrome/Edge)
- **Record the call** to a local .webm (everyone sees a REC indicator) and **group photo** to PNG
- **Voice changer**: robot, chipmunk, deep, alien, radio, megaphone, cave
- **Auto-framing** that zooms in and follows you; **signal-strength bars** on every tile; `?` shows all shortcuts
- **Tools panel** with every fun effect: confetti, party mode, barrel roll, Ghost Protocol, dice, coin
- **Chat** with emoji picker, typing indicators, new-message previews and slash commands (`/help`)
- **Easter eggs** (Settings > Secrets tracks what you've found). The headline one, Ghost Protocol: photograph your empty room and when you leave, everyone watches you fade out of it

Pages: Landing (`/`), Create meeting (`/new`), Join (`/join`), Meeting (`/meeting/abc-defg-hij`), Settings (`/settings`).

---

## Quick start

Requires Node 18+.

```bash
npm install
npm run dev
```

Open http://localhost:8777. With no configuration at all it already works between different computers on the internet, using free public MQTT brokers for signaling and public STUN servers (see [Limitations](#limitations-of-the-free-infrastructure) for what that means).

To try a call by yourself, open the meeting link in a second browser (for example Chrome and Edge) or on your phone.

> Camera, microphone and the encryption API only work on **secure origins**: `https://` or `localhost`. Opening the dev server from another device via `http://192.168.x.x:8777` won't work. Deploy it (free, below) or use an HTTPS tunnel to test across devices.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 8777 |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` on port 8777 |
| `npm run test:e2e` | Two-browser end-to-end test (needs the dev server running, plus Chrome and Edge installed) |

---

## Architecture

```
  Browser A                 Signaling relay (free)                Browser B
 ┌──────────┐   encrypted   ┌──────────────────────────┐ encrypted ┌──────────┐
 │ Yapameet │──────────────▶│ Supabase Realtime         │◀─────────│ Yapameet │
 │ (static) │  offers,      │   - or -                  │  answers, │ (static) │
 └────┬─────┘  ICE, chat,   │ public MQTT brokers       │  ICE, chat└────┬─────┘
      │        presence     └──────────────────────────┘                 │
      │                                                                   │
      │          STUN (public, free): "what's my public address?"         │
      │                                                                   │
      └══════════════ WebRTC audio/video, peer-to-peer ═══════════════════┘
                 (falls back to a TURN relay only if one is configured
                  and a direct path is impossible)
```

**Hosting:** the app is a static React + Vite + TypeScript site. Any static host works; Cloudflare Pages and GitHub Pages are both free.

**Signaling (finding each other):** WebRTC can't connect two browsers without first exchanging SDP offers/answers and ICE candidates through some third party. Yapameet supports two free options behind one interface (`src/signaling/`):

1. **Supabase Realtime Broadcast** (recommended): a free Supabase project, no database tables needed.
2. **Public MQTT brokers** (zero-config default): `broker.emqx.io` and `broker.hivemq.com` over secure WebSockets. Yapameet connects to all configured brokers and publishes to each; duplicates are dropped. Two people only need one broker in common.

**End-to-end encrypted signaling:** because the relays are third parties (and the MQTT brokers are fully public), every signaling message is encrypted with AES-GCM using a key derived from the meeting code (PBKDF2, 150k iterations), and the channel name is a separate hash of the code. The relay sees random-looking channel names and ciphertext. Without the meeting code nobody can read SDP or chat, or inject fake offers. Generated codes are 10 random letters (about 46 bits).

**Media:** a **full mesh**: every participant has one `RTCPeerConnection` to every other participant. Nothing goes through a media server.

### How a meeting works

1. **Create:** `/new` generates a random code like `kpr-tamq-hzx`. Nothing is registered anywhere. A meeting is just a code; it "exists" whenever someone is connected to its channel. Links work forever.
2. **Pre-join:** the meeting page asks for your name and shows a camera/mic preview. Mic and camera are requested separately, so a missing or blocked camera doesn't block your mic (and you can join with neither, to watch and chat).
3. **Announce:** on joining you subscribe to the room channel and broadcast `hello` with your name and mic/camera state. Everyone already there replies directly to you.
4. **Connect:** for each pair, the peer with the lower random id is the **initiator**. It creates the connection with a fixed layout of four transceivers (mic, camera, screen video, screen audio) and sends an offer; the other side adopts that layout and answers. ICE candidates are batched and trickled. Only one side ever offers, so there is no offer collision.
5. **Media changes without renegotiation:** muting, switching camera or mic, turning the camera off (which releases the device so its light turns off) and starting/stopping screen share all use `replaceTrack` on the fixed transceivers. State (muted, camera, presenting, name) is broadcast so others' UIs update instantly.
6. **Presence:** heartbeats every 8 s. A goodbye message on leave/close, plus an MQTT "last will" so the broker announces you if your browser crashes. Peers with no heartbeat for 30 s and no live connection are removed.
7. **Recovery:** `disconnected` for 3.5 s or `failed` triggers an ICE restart (the non-initiator asks the initiator to do it). Repeated failures rebuild the connection from scratch. A connection that closes without events is detected and rebuilt. When signaling reconnects, you re-announce. Reloading the tab keeps a per-tab client id, so others replace your old connection instead of showing a duplicate.
8. **Bandwidth:** as the room grows, each video sender's bitrate is capped (1.8 Mbps for 1:1, down to 280 kbps and half resolution for 7+ people) to keep the mesh usable.

### Project layout

```
src/
  config.ts                 env-driven config, ICE server list (+ optional TURN fetch)
  signaling/
    SignalingChannel.ts     encryption, addressing, de-duplication on top of a transport
    supabaseTransport.ts    Supabase Realtime Broadcast
    mqttTransport.ts        public MQTT brokers (multi-broker)
    types.ts                message protocol
  rtc/
    LocalMedia.ts           mic/camera/screen tracks, devices, permission errors
    MeetingSession.ts       mesh: peers, offers/answers/ICE, recovery, chat, snapshot for React
  lib/                      crypto, meeting codes, settings, sounds, speaking detection, hooks
  components/               call view, video grid/tiles, chat, people, pre-join, device panel
  pages/                    Landing, NewMeeting, Join, Meeting, Settings
functions/api/turn.ts       optional Cloudflare Pages Function minting TURN credentials
tests/e2e.mjs               two-browser end-to-end test
```

---

## Environment variables

All optional. Copy `.env.example` to `.env.local` for development, or set them in your host's build settings. They're read at **build time** and end up in the public JavaScript bundle, so never put secrets in a `VITE_` variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_SIGNALING` | auto | `supabase` or `mqtt`. Auto = Supabase if both Supabase vars are set, else MQTT. |
| `VITE_SUPABASE_URL` | | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | | Supabase anon / publishable key (designed to be public) |
| `VITE_MQTT_URLS` | EMQX + HiveMQ public brokers | Comma-separated `wss://` MQTT URLs |
| `VITE_STUN_URLS` | Google + Cloudflare STUN | Comma-separated STUN URLs |
| `VITE_TURN_URLS` | | Static TURN URLs (comma-separated) |
| `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | | Static TURN credentials |
| `VITE_TURN_CREDENTIALS_URL` | | URL returning `RTCIceServer[]` or `{ iceServers }`, e.g. `/api/turn` |
| `VITE_FORCE_RELAY` | `false` | `true` sends all media via TURN, to check your TURN setup |
| `VITE_BASE` | `/` | Sub-path when hosted in a folder, e.g. `/yapameet/` |

Everyone in a meeting must use the **same signaling backend**. A build with Supabase and a build with MQTT can't see each other.

### Setting up Supabase (free, about 3 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Project Settings > API: copy the **Project URL** and the **anon / publishable key**.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then rebuild.

No tables or SQL are needed: Yapameet only uses Realtime Broadcast on public channels. If your project has public Realtime access turned off (Realtime settings), turn it on, otherwise channel joins fail with an error.

### Adding a free TURN relay (optional, recommended)

STUN only tells a browser its public address. When both people are behind strict NATs or firewalls (many offices, schools, some mobile carriers), a direct connection is impossible and a TURN server has to relay the media. Free options:

- **Cloudflare Realtime TURN:** 1,000 GB/month free (shared with Cloudflare's SFU), then $0.05/GB. Credentials must be minted with a secret, which `functions/api/turn.ts` does for you on Cloudflare Pages (free Functions tier). In the Cloudflare dashboard go to Realtime > TURN, create a key, then in your Pages project add `CF_TURN_KEY_ID` (variable) and `CF_TURN_API_TOKEN` (secret), and build with `VITE_TURN_CREDENTIALS_URL=/api/turn`.
- **Metered Open Relay:** 20 GB/month free with a free account. Either set `VITE_TURN_CREDENTIALS_URL=https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_KEY` or paste static credentials into `VITE_TURN_URLS` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`. Those values are visible to anyone who opens your site, so others could use up your quota.

To stay at $0 on Cloudflare, keep an eye on usage in the dashboard. TURN is only used for the minority of calls that can't connect directly. Set `VITE_FORCE_RELAY=true` in a test build to confirm your TURN works (Settings > "Show connection details" then shows "Relay" on each tile).

---

## Free deployment

### Cloudflare Pages (recommended)

1. Push this folder to a GitHub repository.
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, and pick the repo.
3. Build command `npm run build`, output directory `dist`.
4. Add any `VITE_*` variables (and the `CF_TURN_*` ones if you use the TURN function) under Settings > Variables and Secrets, then redeploy.

Deep links like `/meeting/abc-defg-hij` work automatically: Cloudflare Pages serves `index.html` for unknown paths when the site has no `404.html` (the build only creates one for GitHub Pages). The `functions/` folder is deployed as Pages Functions with no extra setup.

### GitHub Pages

**One command (no git needed, just the GitHub CLI logged in with `gh auth login`):**

```bash
npm run publish:gh
```

This creates a public repo `<you>/yapameet` if needed, pushes the source to `main` and the built site to `gh-pages`, and turns on Pages. Re-run it to redeploy. `GH_REPO=owner/name` picks another repo. Put any `VITE_*` settings in `.env.local` first; they're baked into the build.

**Or with the included Actions workflow** (your token needs the `workflow` scope to push it):

1. Push to GitHub (branch `main`).
2. Repo Settings > Pages > Source: **GitHub Actions**.
3. Optional: Settings > Secrets and variables > Actions > **Variables**: add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, etc.
4. The included workflow (`.github/workflows/pages.yml`) builds with the right base path (`/REPO-NAME/`) and copies `index.html` to `404.html` so meeting links work. For a custom domain or a `USER.github.io` repo, set the variable `VITE_BASE` to `/`.

GitHub Pages can't run the TURN function. Use Metered there, or point `VITE_TURN_CREDENTIALS_URL` at a Cloudflare Pages/Worker deployment of `functions/api/turn.ts`.

Either way the result is static files on a free CDN with HTTPS, which camera/mic access requires.

---

## Limitations of the free infrastructure

Being honest about what $0 buys:

**Mesh scaling.** With N people, everyone uploads N-1 copies of their video and decodes N-1 streams. Yapameet lowers bitrates as rooms grow, but practically:
- 2 to 4 people: smooth on normal connections.
- 5 to 6: fine on good connections, laptops get warm.
- 7 to 8+: upload bandwidth and CPU run out. Ask people to turn cameras off, or this needs an SFU (a media server), which costs money to run. There is no hard cap in the app.

**Connectivity.** STUN alone gets most calls connected directly, but **not all**. Symmetric NATs, carrier-grade NAT on some mobile networks, and corporate/school firewalls can block peer-to-peer completely. Without a TURN server those pairs show "Can't connect (network blocks peer-to-peer)". With free TURN they connect until the monthly quota runs out (1,000 GB Cloudflare, 20 GB Metered). Video relayed through TURN uses roughly 0.5 to 1.5 GB per person per hour.

**Public MQTT brokers (default signaling).** Free community brokers with no SLA: they can be slow, rate-limit, or disappear. Yapameet uses several at once and encrypts everything, but for anything you rely on, use Supabase. Your IP address is visible to the broker (as with any website).

**Supabase free tier.** 200 concurrent Realtime connections per project (that's 200 people in meetings at the same time, across all meetings) and 100 messages/second. Monthly message allowances also apply; a 4-person meeting uses roughly 4,000 to 6,000 messages per hour, mostly heartbeats. Free projects are paused after a period of inactivity; un-pause from the dashboard.

**Security model.** Anyone with the link can join; there are no host controls (kick, mute others, admit from a waiting room) because there is no server to enforce them. Short custom codes like `team-standup` are guessable; use generated codes for private calls. Media is always encrypted peer-to-peer, but with TURN enabled the relay carries (still encrypted) media.

**Background effects.** The segmentation model (about 250 KB) is fetched from Google's public MediaPipe model storage the first time someone turns on blur or a virtual background; the WebAssembly runtime is served by the site itself. Override the model URL with `VITE_SEGMENTER_MODEL_URL` if you want to self-host it. Effects cost CPU/GPU; at 1080p on older laptops use 720p.

**Browsers.** Built and tested for Chrome and Edge. Speaker selection (`setSinkId`) and system-audio screen sharing are Chromium features: Firefox and Safari fall back to default speakers, and Safari cannot share audio with the screen. Mobile browsers can't share the screen.

---

## Testing

`tests/e2e.mjs` launches **two separate browser processes (Chrome and Edge, separate profiles)** with Chromium's fake camera/mic devices, joins the same meeting through the real public signaling service, and verifies real media:

- create meeting, join by pasted link (uppercase, via the Join page)
- both sides connected, remote video frames advancing, inbound audio energy increasing, speaking ring
- mute (zero audio energy received while muted) / unmute, camera off (device released) / on
- switching camera and microphone mid-call (checks the peer connection sends the new track)
- speaker selection (`setSinkId` applied), screen share shown in spotlight, then stopped
- chat both ways with unread badge, participants panel
- leave (noticed in about 0.3 s) and rejoin, tab reload without duplicate participants
- recovery after a peer connection dies silently on either side, ICE restart, signaling relay drop and reconnect
- a third participant joining (full mesh), and cleanup on leave (no session, no video elements left)

Run it with `npm run dev` in one terminal and `npm run test:e2e` in another (`HEADED=1` to watch). To test the production build instead, run `npm run build && npx vite preview --port 8778` and set `BASE_URL=http://localhost:8778` (this also avoids dev-server hot reloads restarting the test browsers if you edit code mid-run).

Two notes from writing the test:
- Video checks count real decoded frames with `requestVideoFrameCallback`. A frozen stream still advances `video.currentTime`, so that alone proves nothing.
- Chromium's synthetic second camera (`fake_device_1`) never delivers frames to an RTP sender. That also happens with a bare `RTCPeerConnection` and no Yapameet code, and real webcams aren't affected. So the camera-switch test checks that the sender's track is swapped, then switches back to the first fake camera and confirms frames arrive.

**Not covered by automation:** two physically separate computers on different networks. The test uses separate browser processes on one machine, talking through the real internet relay, but ICE then finds a local path. Whether a given pair of networks connects directly depends on their NATs (see Limitations). To try it yourself: deploy (free, above), open the link on your computer and on your phone using mobile data, and turn on Settings > "Show connection details" to see whether each person is Direct or Relay.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Secure connection required" | Use `https://` or `localhost`. |
| Camera/mic "blocked" | Click the camera icon in the address bar, allow, then "Try again". On Windows also check Settings > Privacy > Camera/Microphone. |
| "In use by another app" | Close Zoom/Teams/OBS or other tabs using the camera. |
| Stuck on "Connecting…" for one person | Their network blocks peer-to-peer. Configure TURN. |
| Red banner "Can't reach the signaling service" | Brokers or Supabase unreachable (some school/office networks block them). Try Supabase or another network. |
| No sound | Click the "enable sound" banner if shown, check the speaker selection in Settings. |

## Credits

Sound effects are real recordings from [Mixkit](https://mixkit.co/free-sound-effects/) under the Mixkit Sound Effects Free License (public/sfx). Background segmentation and face tracking use Google MediaPipe models.
