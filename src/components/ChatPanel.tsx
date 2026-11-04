import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal, X } from 'lucide-react';
import type { ChatMessage } from '../rtc/MeetingSession';
import { formatTime } from '../lib/hooks';

const URL_RE = /(https?:\/\/[^\s<]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ChatPanel({
  messages,
  onSend,
  onClose,
  disabled,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Auto-scroll to new messages unless the user scrolled up to read history.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
    stick.current = true;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside className="side-panel" aria-label="Chat">
      <div className="side-head">
        <h2>In-call messages</h2>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close chat">
          <X size={20} />
        </button>
      </div>
      <p className="side-note">Messages are only seen by people in the call and disappear when you leave.</p>
      <div
        className="chat-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        data-testid="chat-list"
      >
        {messages.length === 0 && <div className="chat-empty">No messages yet. Say hi 👋</div>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.from === m.from && m.ts - prev.ts < 120_000;
          return (
            <div key={m.id} className={`chat-msg ${m.isLocal ? 'mine' : ''} ${grouped ? 'grouped' : ''}`} data-testid="chat-msg">
              {!grouped && (
                <div className="chat-meta">
                  <span className="chat-name">{m.isLocal ? 'You' : m.name}</span>
                  <time>{formatTime(m.ts)}</time>
                </div>
              )}
              <div className="chat-text">
                <Linkified text={m.text} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-input">
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          onKeyDown={onKey}
          placeholder={disabled ? 'Reconnecting…' : 'Send a message'}
          aria-label="Message"
          data-testid="chat-input"
        />
        <button className="icon-btn" onClick={send} disabled={!text.trim() || disabled} aria-label="Send" data-testid="chat-send">
          <SendHorizontal size={18} />
        </button>
      </div>
    </aside>
  );
}
