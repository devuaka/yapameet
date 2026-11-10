import { useEffect, useRef, useState } from 'react';
import { Dices, Paintbrush, SkipForward, Square, Swords, Target, Trophy, Vote } from 'lucide-react';
import { RPS_EMOJI, THROWABLES, type DrawGuessStore, type FunEvent, type FunStore, type RpsChoice, type ThrowId } from '../rtc/games';
import type { PollStore } from '../rtc/collab';
import type { Participant } from '../rtc/MeetingSession';
import { WYR } from '../lib/gameContent';
import { useEmitter, useNow } from '../lib/hooks';
import { sounds } from '../lib/sounds';
import { useToast } from './Toast';

// ---------------------------------------------------------------- Draw & Guess HUD

export function DrawGuessBanner({ dg }: { dg: DrawGuessStore }) {
  useEmitter(dg);
  const now = useNow(250);
  const [text, setText] = useState('');
  if (!dg.active) return null;
  const secs = Math.max(0, Math.ceil((dg.endsAt - now) / 1000));
  const board = dg.leaderboard();

  if (dg.phase === 'over') {
    return (
      <div className="dg-banner dg-over" data-testid="dg-over">
        <Trophy size={22} />
        <b>{board[0] ? `${board[0].isMe ? 'You win' : `${board[0].name} wins`}!` : 'Game over'}</b>
        <ol className="dg-podium">
          {board.slice(0, 5).map((p) => (
            <li key={p.id} className={p.isMe ? 'me' : ''}>
              {p.name} <span>{p.pts}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="dg-banner" data-testid="dg-banner">
      <div className="dg-main">
        <span className="dg-round">
          Round {dg.round}/{dg.total}
        </span>
        {dg.phase === 'reveal' ? (
          <span className="dg-word" data-testid="dg-reveal">
            The word was <b>{dg.word}</b>
          </span>
        ) : dg.isDrawer ? (
          <span className="dg-word" data-testid="dg-secret">
            <Paintbrush size={16} /> Draw: <b>{dg.word || '…'}</b>
          </span>
        ) : (
          <span className="dg-hint" data-testid="dg-hint">
            {[...dg.hint].map((ch, i) => (
              <i key={i}>{ch === ' ' ? ' ' : ch}</i>
            ))}
            <small>({dg.hint.replace(/ /g, '').length})</small>
          </span>
        )}
        {dg.phase === 'drawing' && <span className={`dg-timer ${secs <= 10 ? 'low' : ''}`}>{secs}s</span>}
        {dg.isDrawer && (
          <button className="btn btn-small btn-ghost" onClick={() => dg.skip()}>
            <SkipForward size={14} /> Skip
          </button>
        )}
      </div>
      {dg.phase === 'drawing' && !dg.isDrawer && !dg.guessed.has(dg.me) && (
        <form
          className="dg-guess"
          onSubmit={(e) => {
            e.preventDefault();
            dg.guess(text);
            setText('');
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your guess…" maxLength={60} autoComplete="off" data-testid="dg-guess" />
          <button className="btn btn-small btn-primary" type="submit" disabled={!text.trim()}>
            Guess
          </button>
        </form>
      )}
      {dg.guessed.has(dg.me) && dg.phase === 'drawing' && <div className="dg-got">You got it! Waiting for the others…</div>}
      <div className="dg-side">
        <ol className="dg-scores" data-testid="dg-scores">
          {board.map((p) => (
            <li key={p.id} className={`${p.isMe ? 'me' : ''} ${dg.guessed.has(p.id) ? 'ok' : ''} ${p.id === dg.drawer ? 'drawer' : ''}`}>
              {p.id === dg.drawer ? '✏️' : dg.guessed.has(p.id) ? '✅' : '·'} {p.name} <span>{p.pts}</span>
            </li>
          ))}
        </ol>
        <ul className="dg-feed">
          {dg.feed.slice(-4).map((f) => (
            <li key={f.id} className={f.ok ? 'ok' : ''}>
              {f.name && <b>{f.name}:</b>} {f.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- throwables

/** Projectiles fly across the stage and splat on the target tile, for everyone. */
export function ThrowLayer({ fun }: { fun: FunStore }) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      fun.on((e: FunEvent) => {
        if (e.kind !== 'throw') return;
        const root = layer.current;
        const stage = root?.parentElement;
        const tile = stage?.querySelector<HTMLElement>(`[data-pid="${e.target}"]`);
        if (!root || !stage || !tile) return;
        const item = THROWABLES.find((t) => t.id === e.item)!;
        const sr = stage.getBoundingClientRect();
        const tr = tile.getBoundingClientRect();
        const from = stage.querySelector<HTMLElement>(`[data-pid="${e.from}"]`)?.getBoundingClientRect();
        const sx = from ? from.left + from.width / 2 - sr.left : sr.width / 2;
        const sy = from ? from.top + from.height / 2 - sr.top : sr.height + 20;
        const tx = tr.left + tr.width * (0.3 + Math.random() * 0.4) - sr.left;
        const ty = tr.top + tr.height * (0.3 + Math.random() * 0.3) - sr.top;
        const proj = document.createElement('div');
        proj.className = 'throw-proj';
        proj.textContent = item.emoji;
        root.appendChild(proj);
        sounds.throw();
        const peak = Math.min(sy, ty) - 120;
        const anim = proj.animate(
          [
            { transform: `translate(${sx}px, ${sy}px) scale(0.6) rotate(0deg)` },
            { transform: `translate(${(sx + tx) / 2}px, ${peak}px) scale(1.4) rotate(270deg)`, offset: 0.5 },
            { transform: `translate(${tx}px, ${ty}px) scale(1.1) rotate(540deg)` },
          ],
          { duration: 650, easing: 'cubic-bezier(.3,.6,.4,1)' },
        );
        anim.onfinish = () => {
          proj.remove();
          if (item.splat) sounds.splat();
          else sounds.pop();
          const hit = document.createElement('div');
          hit.className = item.splat ? 'throw-splat' : 'throw-hearts';
          hit.style.left = `${tx}px`;
          hit.style.top = `${ty}px`;
          if (item.splat) {
            hit.style.setProperty('--splat', item.splat);
            hit.innerHTML = `<span>${item.emoji}</span>`;
          } else hit.textContent = item.emoji.repeat(3);
          root.appendChild(hit);
          tile.classList.remove('hit-shake');
          void tile.offsetWidth;
          tile.classList.add('hit-shake');
          window.setTimeout(() => hit.remove(), 3200);
        };
      }),
    [fun],
  );
  return <div className="throw-layer" ref={layer} aria-hidden="true" />;
}

export function ThrowPicker({ onPick }: { onPick: (id: ThrowId) => void }) {
  return (
    <div className="throw-picker" role="menu" aria-label="Throw something">
      {THROWABLES.map((t) => (
        <button key={t.id} onClick={() => onPick(t.id)} title={t.label} aria-label={`Throw ${t.label}`} data-testid={`throw-${t.id}`}>
          {t.emoji}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- spin the wheel

const WHEEL_COLORS = ['#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#ef4444', '#a855f7'];

export function SpinOverlay({ spin, onDone }: { spin: { names: string[]; idx: number; by: string }; onDone: () => void }) {
  const [landed, setLanded] = useState(false);
  const n = spin.names.length;
  const seg = 360 / n;
  // Land the chosen segment under the pointer at the top, after several turns.
  const final = 360 * 6 + (360 - (spin.idx * seg + seg / 2));
  // Keep the latest callback without restarting the spin when the parent re-renders.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    sounds.wheel();
    const t1 = window.setTimeout(() => {
      setLanded(true);
      sounds.reveal();
    }, 4300);
    const t2 = window.setTimeout(() => done.current(), 7500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const r = 140;
  return (
    <div className="spin-overlay" data-testid="spin-overlay" onClick={() => landed && onDone()}>
      <div className="spin-card">
        <div className="spin-by">{spin.by} spun the wheel</div>
        <div className="spin-wheel-wrap">
          <div className="spin-pointer" />
          <svg viewBox="-150 -150 300 300" className="spin-wheel" style={{ ['--final' as string]: `${final}deg` }}>
            {spin.names.map((name, i) => {
              const a0 = ((i * seg - 90) * Math.PI) / 180;
              const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
              const large = seg > 180 ? 1 : 0;
              const mid = ((i + 0.5) * seg - 90) * (Math.PI / 180);
              return (
                <g key={i}>
                  <path d={`M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`} fill={WHEEL_COLORS[i % WHEEL_COLORS.length]} />
                  <text
                    x={r * 0.6 * Math.cos(mid)}
                    y={r * 0.6 * Math.sin(mid)}
                    transform={`rotate(${(i + 0.5) * seg} ${r * 0.6 * Math.cos(mid)} ${r * 0.6 * Math.sin(mid)})`}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="spin-label"
                  >
                    {name.length > 12 ? `${name.slice(0, 11)}…` : name}
                  </text>
                </g>
              );
            })}
            <circle r="18" className="spin-hub" />
          </svg>
        </div>
        <div className={`spin-result ${landed ? 'show' : ''}`} data-testid="spin-result">
          {landed ? `🎯 ${spin.names[spin.idx]}!` : 'Spinning…'}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rock paper scissors

export function RpsPrompt({ name, onPick, onDecline }: { name: string; onPick: (c: RpsChoice) => void; onDecline: () => void }) {
  return (
    <div className="rps-prompt" data-testid="rps-prompt">
      <b>⚔️ {name} challenges you!</b>
      <span>Rock, paper or scissors?</span>
      <div className="rps-choices">
        {(Object.keys(RPS_EMOJI) as RpsChoice[]).map((c) => (
          <button key={c} onClick={() => onPick(c)} aria-label={c} data-testid={`rps-answer-${c}`}>
            {RPS_EMOJI[c]}
          </button>
        ))}
      </div>
      <button className="btn btn-small btn-ghost" onClick={onDecline}>
        Chicken out
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Games page (Activities)

export function GamesView({
  dg,
  fun,
  polls,
  participants,
}: {
  dg: DrawGuessStore;
  fun: FunStore;
  polls: PollStore;
  participants: Participant[];
}) {
  useEmitter(dg);
  const toast = useToast();
  const others = participants.filter((p) => !p.isLocal && !p.leaving);
  const [opponent, setOpponent] = useState('');
  const target = others.find((p) => p.id === opponent) ?? others[0];

  return (
    <section className="tools-section games-view">
      <div className="game-card">
        <div className="game-head">
          <Paintbrush size={20} />
          <b>Draw & Guess</b>
        </div>
        <p className="muted small">Take turns drawing a secret word on the whiteboard. Guess fast for more points. Needs 2+ people.</p>
        {dg.active ? (
          <div className="create-actions">
            <span className="muted small">
              Round {dg.round}/{dg.total} in progress
            </span>
            {dg.isHost && (
              <button className="btn btn-small btn-ghost" onClick={() => dg.stop()} data-testid="dg-stop">
                <Square size={12} /> Stop game
              </button>
            )}
          </div>
        ) : (
          <button
            className="btn btn-primary btn-small"
            onClick={() => {
              if (!dg.start()) toast('You need at least 2 people to play', 'error');
            }}
            data-testid="dg-start"
          >
            Start game
          </button>
        )}
      </div>

      <div className="game-card">
        <div className="game-head">
          <Target size={20} />
          <b>Spin the wheel</b>
        </div>
        <p className="muted small">Randomly picks someone. Who goes first? Who has to answer? The wheel decides.</p>
        <button
          className="btn btn-small"
          onClick={() => {
            if (!fun.spin()) toast('Spin needs at least 2 people', 'error');
          }}
          data-testid="spin-start"
        >
          <Dices size={14} /> Spin
        </button>
      </div>

      <div className="game-card">
        <div className="game-head">
          <Swords size={20} />
          <b>Rock Paper Scissors</b>
        </div>
        {others.length ? (
          <>
            <label className="field">
              <span>Challenge</span>
              <select value={target?.id ?? ''} onChange={(e) => setOpponent(e.target.value)} data-testid="rps-opponent">
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="rps-choices">
              {(Object.keys(RPS_EMOJI) as RpsChoice[]).map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    if (!target) return;
                    fun.challenge(target.id, c);
                    toast(`You picked ${RPS_EMOJI[c]}. Waiting for ${target.name}…`);
                  }}
                  aria-label={`Challenge with ${c}`}
                  data-testid={`rps-${c}`}
                >
                  {RPS_EMOJI[c]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted small">Needs someone to challenge.</p>
        )}
      </div>

      <div className="game-card">
        <div className="game-head">
          <Vote size={20} />
          <b>Would You Rather</b>
        </div>
        <p className="muted small">Draws a random question as a live poll for everyone.</p>
        <button
          className="btn btn-small"
          onClick={() => {
            const [a, b] = WYR[Math.floor(Math.random() * WYR.length)];
            polls.create('Would you rather…', [a, b], false);
            toast('Question posted in Polls', 'success');
          }}
          data-testid="wyr-start"
        >
          <Vote size={14} /> Draw a question
        </button>
      </div>

      <p className="muted small">
        Tip: hover anyone's video and hit 🍅 to throw something at them.
      </p>
    </section>
  );
}
