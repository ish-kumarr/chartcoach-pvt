"use client";
import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import type { LessonCoachMessage } from "@/lib/agents/lesson-coach";
import { transcriptTime } from "@/lib/transcript";
import styles from "./lesson-study.module.css";

type Part = LessonCoachMessage["parts"][number];
type Practice = Extract<Part, { type: "tool-showPractice" }>;
type PracticeData = NonNullable<Practice["output"]>;
function SourceButton({ seconds, onSeek }: { seconds: number; onSeek: (seconds: number) => void }) {
  return <button className={styles.source} type="button" onClick={() => onSeek(seconds)}>▶ Watch at {transcriptTime(seconds)}</button>;
}
export function PracticeCard({ data, onSeek }: { data: PracticeData; onSeek: (seconds: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return <article className={styles.card}>
    <p className={styles.cardLabel}>Practice question</p><h3>{data.question}</h3>
    <div className={styles.answers}>{data.options.map((option, index) => <button type="button" key={index} aria-pressed={selected === index} onClick={() => setSelected(index)}>{option}</button>)}</div>
    {selected !== null && <div role="status" className={styles.feedback}><strong>{selected === data.correctIndex ? "Correct." : "Not quite. Try again."}</strong><MessageResponse>{data.explanation}</MessageResponse></div>}
    <SourceButton seconds={data.reference.seconds} onSeek={onSeek} />
  </article>;
}

export function CoachPart({ part, onSeek }: { part: Part; onSeek: (seconds: number) => void }) {
  if (part.type === "text") return <MessageResponse>{part.text}</MessageResponse>;
  if (part.type === "tool-showReferences" || part.type === "tool-showConcept" || part.type === "tool-showPractice") {
    if (part.state === "output-error") return <p role="status">This study card couldn’t be created. Try asking again.</p>;
    if (part.state !== "output-available") return <p role="status" className={styles.small}>Preparing a study card…</p>;
    if (part.type === "tool-showPractice") return <PracticeCard data={part.output} onSeek={onSeek} />;
    if (part.type === "tool-showReferences") return <article className={styles.card}><p className={styles.cardLabel}>From the lecture</p><h3>{part.output.title}</h3>{part.output.references.map((reference) => <div key={reference.id}><p>{reference.text}</p><SourceButton seconds={reference.seconds} onSeek={onSeek} /></div>)}</article>;
    return <article className={styles.card}><p className={styles.cardLabel}>Concept recap</p><h3>{part.output.title}</h3><MessageResponse>{part.output.explanation}</MessageResponse><ul>{part.output.points.map((point, index) => <li key={index}>{point}</li>)}</ul><SourceButton seconds={part.output.reference.seconds} onSeek={onSeek} /></article>;
  }
  return null;
}

export default function LessonChat({ lessonId, position, onSeek }: { lessonId: string; position: number; onSeek: (seconds: number) => void }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [check, setCheck] = useState(0);
  const transport = useMemo(() => new DefaultChatTransport<LessonCoachMessage>({
    api: "/api/lesson-chat",
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: {
      ...body,
      // Send conversational text only. Tool outputs and transcript context
      // are generated/loaded on the server, not trusted from browser history.
      messages: messages.slice(-20).map((message) => ({ id: message.id, role: message.role, parts: message.parts.filter((part) => part.type === "text" && part.text.trim()) })).filter((message) => message.parts.length),
    } }),
  }), []);
  const { messages, sendMessage, status, error, stop, regenerate, clearError } = useChat<LessonCoachMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/lesson-chat", { signal: abort.signal }).then((res) => res.ok ? res.json() : { configured: false }).then((data) => { if (!abort.signal.aborted) setConnected(Boolean(data.configured) && lessonId === "local-lecture"); }).catch(() => { if (!abort.signal.aborted) setConnected(false); });
    return () => abort.abort();
  }, [check, lessonId]);
  function send(text: string) {
    if (!text.trim() || !connected || busy) return;
    clearError();
    void sendMessage({ text: text.trim() }, { body: { lessonId, position } });
    setInput("");
  }
  return <section data-tour-target="chat" className={styles.chat} aria-label="Lesson assistant">
    <header className={styles.panelHeader}><div><h2>Ask ChartCoach</h2><p>About this lecture · {transcriptTime(position)}</p></div><span className={styles.badge}>{connected ? "Connected" : connected === null ? "Checking…" : "Not connected"}</span></header>
    <Conversation className={styles.conversation}><ConversationContent className={styles.messages}>
      {!messages.length && <div className={styles.empty}>
        <h3>Make sense of what you’re watching</h3><p>Ask for an explanation, a moment in the lecture, or a practice question.</p>
        <div className={styles.suggestions}>{["Explain this part simply", "Show the key ideas", "Give me a practice question"].map((text) => <button key={text} type="button" disabled={!connected || busy} onClick={() => send(text)}>{text}</button>)}</div>
        {connected === false && <div className={styles.connectionNotice}><p>The lesson assistant is ready to connect. AI responses will be available after setup.</p><button type="button" onClick={() => setCheck((value) => value + 1)}>Check connection</button></div>}
      </div>}
      {messages.map((message) => <Message key={message.id} from={message.role}><MessageContent className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>{message.parts.map((part, index) => <CoachPart key={`${message.id}-${index}`} part={part} onSeek={onSeek} />)}</MessageContent></Message>)}
      {busy && <p role="status" className={styles.small}>ChartCoach is responding…</p>}
      {error && <div role="alert" className={styles.connectionNotice}>Couldn’t get a response. <button type="button" disabled={busy} onClick={() => { clearError(); void regenerate({ body: { lessonId, position } }); }}>Retry response</button></div>}
    </ConversationContent><ConversationScrollButton /></Conversation>
    <form className={styles.chatForm} onSubmit={(event) => { event.preventDefault(); send(input); }}>
      <label className={styles.small} htmlFor={`coach-input-${lessonId}`}>Ask about this moment or the whole lecture</label>
      <textarea id={`coach-input-${lessonId}`} value={input} onChange={(event) => setInput(event.target.value)} maxLength={3000} rows={2} disabled={!connected} placeholder="Ask in Hindi or English…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(input); } }} />
      {busy ? <button type="button" onClick={() => void stop()}>Stop response</button> : <button type="submit" disabled={!connected || !input.trim()}>Send message ↑</button>}
    </form>
  </section>;
}
