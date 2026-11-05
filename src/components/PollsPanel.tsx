import { useState } from 'react';
import { BarChart3, Check, Plus, Trash2 } from 'lucide-react';
import { censor } from '../lib/censor';
import type { PollStore } from '../rtc/collab';
import type { Participant } from '../rtc/MeetingSession';
import { useEmitter } from '../lib/hooks';
import { Toggle } from './controls';

/** Polls page (lives inside Activities). */
export function PollsView({
  store,
  participants,
  selfId,
}: {
  store: PollStore;
  participants: Participant[];
  selfId: string;
}) {
  useEmitter(store);
  const [creating, setCreating] = useState(store.polls.length === 0);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [anon, setAnon] = useState(false);
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? 'Someone';

  const submit = () => {
    if (store.create(q, opts, anon)) {
      setQ('');
      setOpts(['', '']);
      setCreating(false);
    }
  };
  const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2;

  return (
    <div className="polls-view" data-testid="polls-panel">
        {creating ? (
          <div className="poll-form">
            <label className="field">
              <span>Question</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pizza or tacos?" maxLength={200} autoFocus data-testid="poll-question" />
            </label>
            {opts.map((o, i) => (
              <div className="poll-opt-row" key={i}>
                <input
                  value={o}
                  onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={`Option ${i + 1}`}
                  maxLength={80}
                  data-testid={`poll-option-${i}`}
                />
                {opts.length > 2 && (
                  <button className="icon-btn ghost" onClick={() => setOpts(opts.filter((_, j) => j !== i))} aria-label="Remove option">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            {opts.length < 8 && (
              <button className="btn btn-small btn-ghost" onClick={() => setOpts([...opts, ''])}>
                <Plus size={14} /> Add option
              </button>
            )}
            <Toggle label="Anonymous votes" checked={anon} onChange={setAnon} />
            <div className="create-actions">
              <button className="btn btn-primary" disabled={!valid} onClick={submit} data-testid="poll-launch">
                <BarChart3 size={16} /> Launch poll
              </button>
              {store.polls.length > 0 && (
                <button className="btn btn-ghost" onClick={() => setCreating(false)}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-block" onClick={() => setCreating(true)} data-testid="poll-new">
            <Plus size={16} /> New poll
          </button>
        )}

        {store.polls.map((p) => {
          const { counts, voters, total } = store.tally(p.id);
          const mine = store.myVote(p.id);
          const showResults = mine !== undefined || p.ended || p.by === selfId;
          return (
            <div key={p.id} className={`poll-card ${p.ended ? 'ended' : ''}`} data-testid="poll-card">
              <div className="poll-meta">
                {p.by === selfId ? 'Your poll' : `${p.byName}'s poll`} · {total} vote{total === 1 ? '' : 's'}
                {p.anonymous && ' · anonymous'}
                {p.ended && ' · ended'}
              </div>
              <h3 className="poll-q">{censor(p.question)}</h3>
              {p.options.map((o, i) => {
                const pct = total ? Math.round((counts[i] / total) * 100) : 0;
                return (
                  <button
                    key={i}
                    className={`poll-option ${mine === i ? 'mine' : ''}`}
                    onClick={() => store.vote(p.id, i)}
                    disabled={p.ended}
                    data-testid={`poll-vote-${i}`}
                    title={!p.anonymous && voters[i].length ? voters[i].map(nameOf).join(', ') : undefined}
                  >
                    {showResults && <span className="poll-bar" style={{ width: `${pct}%` }} />}
                    <span className="poll-label">
                      {mine === i && <Check size={14} />} {censor(o)}
                    </span>
                    {showResults && (
                      <span className="poll-count" data-testid={`poll-count-${i}`}>
                        {counts[i]} · {pct}%
                      </span>
                    )}
                  </button>
                );
              })}
              {p.by === selfId && !p.ended && (
                <button className="btn btn-small btn-ghost" onClick={() => store.end(p.id)}>
                  End poll
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}
