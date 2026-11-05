import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal, Smile } from 'lucide-react';
import { censor } from '../lib/censor';
import type { ChatMessage } from '../rtc/MeetingSession';
import { formatTime } from '../lib/hooks';

const CHAT_EMOJIS = ['😀', '😂', '🥲', '😍', '😎', '🤔', '😮', '😢', '😡', '👍', '👎', '👏', '🙏', '🔥', '🎉', '❤️', '💯', '✅', '👀', '🤝', '🙌', '💀', '🤡', '☕'];

const URL_RE = /(https?:\/\/[^\s<]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = censor(text).split(URL_RE);
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
  disabled,
  typers = [],
  onTyping,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  disabled: boolean;
  typers?: string[];
  onTyping?: () => void;
}) {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
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
    setEmojiOpen(false);
    stick.current = true;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="side-content" aria-label="Chat">
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
          if (m.system) {
            return (
              <div key={m.id} className="chat-msg system" data-testid="chat-note">
                <div className="chat-text">{m.text}</div>
              </div>
            );
          }
          const prev = messages[i - 1];
          const grouped = prev && !prev.system && prev.from === m.from && m.ts - prev.ts < 120_000;
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
      <div className="typing-line" data-testid="typing-line">
        {typers.length > 0 && (
          <>
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            {typers.length === 1 ? `${typers[0]} is typing` : typers.length === 2 ? `${typers[0]} and ${typers[1]} are typing` : 'Several people are typing'}
          </>
        )}
      </div>
      {emojiOpen && (
        <div className="chat-emoji-grid" data-testid="chat-emojis">
          {CHAT_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                setText((t) => (t + e).slice(0, 2000));
                input.current?.focus();
              }}
              aria-label={`Insert ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input">
        <button className="icon-btn ghost chat-emoji-btn" onClick={() => setEmojiOpen((v) => !v)} aria-label="Emoji" title="Emoji" data-testid="chat-emoji-btn">
          <Smile size={20} />
        </button>
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, 2000));
            if (e.target.value.trim() && !e.target.value.startsWith('/')) onTyping?.();
          }}
          onKeyDown={onKey}
          placeholder={disabled ? 'Reconnecting…' : 'Message everyone (try /help)'}
          aria-label="Message"
          data-testid="chat-input"
        />
        <button className="icon-btn" onClick={send} disabled={!text.trim() || disabled} aria-label="Send" data-testid="chat-send">
          <SendHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
