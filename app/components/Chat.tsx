"use client";

import { useEffect, useRef, useState } from "react";
import { blockedLabel } from "@/config/copy";
import { FIND_GROUPS, findLabel, typesInGroup } from "@/config/finds";
import { api } from "@/lib/client";

type Msg = { id: number; role: "user" | "assistant"; content: string; blocked_by: string | null; category?: string | null; report_note?: string | null };

const GREETING = "Hi! I'm the Warung Kita assistant. How can I help?";

/**
 * The Warung Kita chat. Lives inside the customer app's Help tab (Activity 1) and the studio's
 * "try the draft as a customer" pane (Activity 2) — the server decides which bot answers.
 */
export function Chat({
  showMechanism, reportable, onReported, placeholder = "Ask a question…",
}: {
  showMechanism?: boolean; reportable?: boolean; onReported?: () => void; placeholder?: string;
}) {
  const [convId, setConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [reporting, setReporting] = useState<Msg | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    const r = await api<{ conversationId: number | null; messages: Msg[] }>("/api/chat");
    setConvId(r.conversationId);
    setMessages(r.messages);
  };

  useEffect(() => {
    api<{ conversationId: number | null; messages: Msg[] }>("/api/chat").then((r) => {
      setConvId(r.conversationId);
      setMessages(r.messages);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, error]);

  const send = async (msg: string) => {
    if (!msg.trim() || pending) return;
    setPending(msg);
    setError("");
    setText("");
    try {
      const r = await api<{ conversationId: number; messages: Msg[] }>("/api/chat", { body: { text: msg, conversationId: convId } });
      setConvId(r.conversationId);
      setMessages(r.messages);
    } catch (e) {
      setError((e as Error).message);
      setText(msg);
    } finally {
      setPending(null);
    }
  };

  const newChat = async () => {
    const r = await api<{ conversationId: number }>("/api/chat/new", { body: {} });
    setConvId(r.conversationId);
    setMessages([]);
    setError("");
  };

  const copyMsg = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = m.content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(m.id);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="chat">
      <div className="messages">
        <div className="bubble-row bot">
          <span className="avatar">WK</span>
          <div className="msg assistant">{GREETING}</div>
        </div>
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="msg user">{m.content}</div>
          ) : (
            <div key={m.id} className="bubble-row bot">
              <span className="avatar">WK</span>
              <div className="msg assistant">
                {m.content}
                <span className="msg-actions">
                  <button className="copy" onClick={() => copyMsg(m)} aria-label="Copy message" title="Copy">
                    {copied === m.id ? "copied" : "copy"}
                  </button>
                  {reportable && !m.category && <button className="copy" onClick={() => setReporting(m)}>report</button>}
                </span>
                {reportable && m.category && (
                  <button className="reported" onClick={() => setReporting(m)} title="Change or remove this report">
                    Reported · {findLabel(m.category)}
                  </button>
                )}
                {showMechanism && m.blocked_by && m.blocked_by !== "azure_filter" && <span className="blocked">blocked by: {blockedLabel[m.blocked_by]}</span>}
              </div>
            </div>
          )
        )}
        {pending && <div className="msg user">{pending}</div>}
        {pending && <div className="typing">Warung Kita is typing…</div>}
        {error && (
          <div className="notice" style={{ alignSelf: "stretch" }}>
            {error} <button className="linkbtn" onClick={() => send(text)}>Try again</button>
          </div>
        )}
        <p className="ai-note">Answers are written by AI and can be wrong. <button className="linkbtn" onClick={newChat}>Start a new chat</button></p>
        <div ref={endRef} />
      </div>

      {reporting && (
        <ReportSheet
          message={reporting}
          onClose={() => setReporting(null)}
          onDone={async () => { setReporting(null); await reload(); onReported?.(); }}
        />
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="input grow" placeholder={placeholder} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} enterKeyHint="send" aria-label="Message" />
        <button className="send" disabled={!!pending || !text.trim()} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l16-8-6 16-2-7-8-1z" /></svg>
        </button>
      </form>
    </div>
  );
}

/** "What did the bot do?" — participants decide, not the app. */
function ReportSheet({ message, onClose, onDone }: { message: Msg; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<string>(message.category ?? "");
  const [note, setNote] = useState(message.report_note ?? "");
  const [error, setError] = useState("");
  const submit = async (value: string | null) => {
    try {
      await api("/api/report", { body: { messageId: message.id, category: value, note } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Report this reply" onClick={(e) => e.stopPropagation()}>
        <h2>What did the bot do?</h2>
        <p className="sheet-quote">{message.content.length > 160 ? `${message.content.slice(0, 160)}…` : message.content}</p>
        <div className="find-options" role="radiogroup">
          {FIND_GROUPS.map((g) => (
            <fieldset key={g.key}>
              <legend>{g.label}</legend>
              {typesInGroup(g.key).map((t) => (
                <label key={t.key} className={category === t.key ? "on" : ""}>
                  <input type="radio" name="find" checked={category === t.key} onChange={() => setCategory(t.key)} />
                  <span><strong>{t.label}</strong><span>{t.help}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <input className="input" placeholder="Why? (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          {message.category && <button className="linkbtn" onClick={() => submit(null)}>Remove report</button>}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn report-btn" disabled={!category} onClick={() => submit(category)}>Report</button>
        </div>
      </div>
    </div>
  );
}
