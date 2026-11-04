import { QUALITY, getSettings, type CodecPref } from '../lib/settings';

/**
 * Chrome starts every new video connection at ~300 kbps and ramps up over 10-20 s,
 * which is why calls used to look blocky at first. These fmtp hints on the REMOTE
 * description (munging remote SDP is allowed) tell our sender to start high.
 */
export function tuneRemoteSdp(sdp: string): string {
  const preset = QUALITY[getSettings().videoQuality];
  const start = Math.min(preset.maxBitrate, 1_800_000) / 1000;
  const max = Math.round((preset.maxBitrate * 1.2) / 1000);
  const hints = `x-google-start-bitrate=${start};x-google-min-bitrate=${Math.min(300, start)};x-google-max-bitrate=${max}`;

  const lines = sdp.split(/\r\n/);
  const videoPts = new Set<string>();
  let inVideo = false;
  for (const l of lines) {
    if (l.startsWith('m=')) inVideo = l.startsWith('m=video');
    const m = inVideo && l.match(/^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i);
    if (m) videoPts.add(m[1]);
  }
  const hasFmtp = new Set<string>();
  const out = lines.map((l) => {
    const m = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (m && videoPts.has(m[1]) && !m[2].includes('x-google-start-bitrate')) {
      hasFmtp.add(m[1]);
      return `${l};${hints}`;
    }
    if (m && videoPts.has(m[1])) hasFmtp.add(m[1]);
    return l;
  });
  // Codecs without an fmtp line (VP8 usually) get one right after their rtpmap.
  const final: string[] = [];
  for (const l of out) {
    final.push(l);
    const m = l.match(/^a=rtpmap:(\d+) /);
    if (m && videoPts.has(m[1]) && !hasFmtp.has(m[1])) final.push(`a=fmtp:${m[1]} ${hints}`);
  }
  return final.join('\r\n');
}

const MIME: Record<Exclude<CodecPref, 'auto'>, string> = {
  vp8: 'video/VP8',
  vp9: 'video/VP9',
  h264: 'video/H264',
  av1: 'video/AV1',
};

/** Put the preferred codec first (keeps the rest as fallbacks, so peers always agree on something). */
export function applyCodecPreference(tr: RTCRtpTransceiver, pref: CodecPref) {
  if (pref === 'auto' || !('setCodecPreferences' in tr)) return;
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  if (!caps) return;
  const want = MIME[pref].toLowerCase();
  const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === want);
  if (!preferred.length) return;
  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== want);
  try {
    tr.setCodecPreferences([...preferred, ...rest]);
  } catch {
    /* unsupported combination: keep browser default */
  }
}

export function supportedCodecs(): CodecPref[] {
  const caps = RTCRtpReceiver.getCapabilities?.('video');
  const have = new Set(caps?.codecs.map((c) => c.mimeType.toLowerCase()) ?? []);
  return (['auto', 'vp8', 'vp9', 'h264', 'av1'] as CodecPref[]).filter((c) => c === 'auto' || have.has(MIME[c].toLowerCase()));
}

/** Smallest receive buffer the browser allows: lower delay, slightly less smoothing on bad networks. */
export function applyLowLatency(receiver: RTCRtpReceiver, on: boolean) {
  const r = receiver as unknown as Record<string, unknown>;
  try {
    if ('jitterBufferTarget' in receiver) r.jitterBufferTarget = on ? 0 : null;
    else if ('playoutDelayHint' in receiver) r.playoutDelayHint = on ? 0 : null;
  } catch {
    /* not supported */
  }
}

/**
 * Per-peer send budget. Mesh means each person uploads one copy per peer,
 * so the total is split across peers (about 8 Mbps total by default).
 */
export function senderBudget(peers: number) {
  const preset = QUALITY[getSettings().videoQuality];
  const n = Math.max(1, peers);
  const cam = Math.round(Math.min(preset.maxBitrate, Math.max(250_000, 8_000_000 / n)));
  const scale = n >= 7 ? 2 : n >= 5 ? 1.5 : 1;
  const screen = Math.round(Math.min(3_000_000, Math.max(600_000, 6_000_000 / n)));
  return { cam, scale, fps: preset.fps, screen };
}
