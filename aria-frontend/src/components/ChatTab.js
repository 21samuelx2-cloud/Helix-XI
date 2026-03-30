import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

export default function ChatTab({ messages, setMessages, sessionId, onUpdateSession, dashboard, setTab }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [greeting, setGreeting] = useState(null);
  const bottomRef = useRef(null);
  const initiative = dashboard?.initiative || null;

  const starterPrompts = useMemo(() => {
    const prompts = [];
    if (dashboard?.varianceEngine?.headline) prompts.push('What is driving the variance this month?');
    if (dashboard?.alerts?.[0]?.title) prompts.push(`Explain this: ${dashboard.alerts[0].title}`);
    if (dashboard?.dailyBrief?.headline) prompts.push('Give me a quick finance brief.');
    prompts.push('What changed this week?');
    prompts.push('What should I worry about today?');
    prompts.push('Which vendors are costing us the most?');
    return [...new Set(prompts)].slice(0, 4);
  }, [dashboard]);

  useEffect(() => {
    if (messages.length === 0) {
      apiFetch('/api/chat/init')
        .then((data) => {
          if (data.greeting) setGreeting(data.greeting);
        })
        .catch(() => {});
    }
  }, [messages.length]);

  useEffect(() => {
    if (!initiative || messages.length > 0) return;
    const storageKey = `aria-initiative:${sessionId}`;
    const seenSignature = sessionStorage.getItem(storageKey);
    if (seenSignature === initiative.signature) return;
    const opener = { role: 'assistant', content: initiative.message };
    setMessages([opener]);
    onUpdateSession(sessionId, [opener]);
    sessionStorage.setItem(storageKey, initiative.signature);
  }, [initiative, messages.length, onUpdateSession, sessionId, setMessages]);

  useEffect(() => {
    const node = bottomRef.current;
    if (!node) return;
    const id = requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: messages.length > 6 ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    onUpdateSession(sessionId, next);
    setInput('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: next, sessionId }) });
      const updated = [...next, { role: 'assistant', content: res.reply }];
      setMessages(updated);
      onUpdateSession(sessionId, updated);
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: `Error: ${err.message}` }]);
    }
    setLoading(false);
  }

  const briefing = dashboard?.dailyBrief || null;
  const topAlert = dashboard?.alerts?.[0] || null;

  return (
    <div className="chat-wrap">
      {(briefing || topAlert || initiative) && (
        <div className="chat-briefing">
          <div className="chat-briefing-copy">
            <div className="chat-briefing-kicker">{initiative ? 'ARIA Initiated' : 'ARIA Live Brief'}</div>
            <div className="chat-briefing-headline">{initiative?.title || briefing?.headline || topAlert?.title}</div>
            <div className="chat-briefing-text">{initiative?.message || briefing?.narrative || topAlert?.detail}</div>
          </div>
          <div className="chat-briefing-actions">
            {(initiative?.target || topAlert?.target) && (
              <button className="btn-ghost" type="button" onClick={() => setTab(initiative?.target || topAlert?.target)}>
                {initiative?.action || topAlert?.action || 'Open'}
              </button>
            )}
            {(initiative?.score || briefing?.priorities?.[0]) && (
              <span className="chat-briefing-chip">
                {initiative?.score ? `Priority ${initiative.score}` : briefing.priorities[0]}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">AI</div>
            <div className="chat-empty-title">ARIA is online</div>
            {greeting ? (
              <div className="chat-bubble" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', maxWidth: 520, textAlign: 'left' }}>{greeting}</div>
            ) : (
              <div className="chat-empty-sub">Ask me about your finances, transactions, forecasts, or anything you're curious about.</div>
            )}
            <div className="chat-starters">
              {starterPrompts.map((prompt) => (
                <button key={prompt} className="chat-starter" type="button" onClick={() => setInput(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`chat-msg ${message.role}`}>
            {message.role === 'assistant' && <div className="chat-msg-label">ARIA</div>}
            <div className="chat-bubble">{message.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg assistant">
            <div className="chat-msg-label">ARIA</div>
            <div className="chat-bubble chat-typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input-row" onSubmit={send}>
        <input
          className="chat-input"
          placeholder="Ask ARIA anything..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          autoFocus
        />
        <button className="chat-send" type="submit" disabled={loading || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
