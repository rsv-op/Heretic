"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, cn, timeAgo, useResource } from "@/lib/client";
import type { ConversationRow, MessageRow } from "@/lib/types";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingRows,
  Modal,
  Panel,
  SectionHeading,
  Select,
  useToast,
} from "@/components/ui";
import { TypeOut, Waveform } from "@/components/motion";
import { Bolt, Check, Mic, Plus, Speaker, Terminal, Waveform as WaveIcon } from "@/components/Icons";

interface CoreMeta {
  intent: string;
  confidence: number;
  engine: string;
  latencyMs: number;
  speak: string;
  actions: { label: string; href: string; kind: string }[];
}

const STT_ENGINES = ["android-native", "vosk-small-en", "whisper-tiny-int8", "web-speech"];
const TTS_ENGINES = ["android-native", "piper-en-gb-alba", "coqui-vits", "web-speech"];

const SUGGESTIONS = [
  "What can you do?",
  "Why does the GPU delegate fail on Mali?",
  "Is heretic-7b-q4_k_m.gguf useful on a Pixel 7?",
  "How do I build the APK?",
  "What are the privacy safeguards?",
];

export default function ChatPage() {
  const toast = useToast();
  const list = useResource<{ conversations: ConversationRow[] }>("/api/conversations");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<MessageRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [speakOut, setSpeakOut] = useState(true);
  const [meta, setMeta] = useState<CoreMeta | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ConversationRow | null>(null);
  const [draft, setDraft] = useState({ title: "", mode: "text", sttEngine: STT_ENGINES[0], voiceEngine: TTS_ENGINES[0] });

  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [nativeBridge, setNativeBridge] = useState<Window["HereticNative"]>(undefined);

  useEffect(() => {
    setNativeBridge(window.HereticNative);
  }, []);

  /* select the conversation from ?c= once, then default to the newest */
  useEffect(() => {
    if (activeId || !list.data?.conversations.length) return;
    const param = new URLSearchParams(window.location.search).get("c");
    const match = list.data.conversations.find((c) => c.id === param);
    setActiveId((match ?? list.data.conversations[0]).id);
  }, [list.data, activeId]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    try {
      const data = await api<{ conversation: ConversationRow; messages: MessageRow[] }>(`/api/conversations/${id}`);
      setThread(data.messages);
      const last = [...data.messages].reverse().find((m) => m.role === "heretic");
      setMeta(
        last
          ? {
              intent: last.intent ?? "unknown",
              confidence: 0,
              engine: "HereticCore 2.3.0-offline · rule-table · offline",
              latencyMs: last.latencyMs ?? 0,
              speak: "",
              actions: [],
            }
          : null,
      );
    } catch (error) {
      toast.push("error", "Could not load the session", error instanceof Error ? error.message : undefined);
    } finally {
      setThreadLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeId) void loadThread(activeId);
  }, [activeId, loadThread]);

  /* Spoken replies in the APK are gated natively (tts.speak, silent by default).
     The toggle above is the operator's consent, so mirror it into the native gate. */
  useEffect(() => {
    if (!nativeBridge?.grantGate) return;
    nativeBridge.grantGate("tts.speak", speakOut ? "GRANTED" : "DENIED");
  }, [nativeBridge, speakOut]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread]);

  /* native bridge events from the APK */
  useEffect(() => {
    const onStt = (event: Event) => {
      const transcript = (event as CustomEvent<string>).detail;
      setListening(false);
      if (transcript) setInput(transcript);
    };
    const onSttError = (event: Event) => {
      setListening(false);
      toast.push("error", "Recognizer error", (event as CustomEvent<string>).detail);
    };
    const onFile = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      toast.push("info", "File picked through SAF", `${name} — assess it in the File Assessor.`);
    };
    window.addEventListener("heretic-stt", onStt);
    window.addEventListener("heretic-stt-error", onSttError);
    window.addEventListener("heretic-file-picked", onFile);
    return () => {
      window.removeEventListener("heretic-stt", onStt);
      window.removeEventListener("heretic-stt-error", onSttError);
      window.removeEventListener("heretic-file-picked", onFile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = (text: string) => {
    if (!speakOut || !text) return;
    if (nativeBridge) {
      nativeBridge.speak(text);
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.pitch = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    if (nativeBridge) {
      setListening(true);
      nativeBridge.triggerMic();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      toast.push(
        "error",
        "No recognizer available",
        "This browser exposes no Web Speech API. Inside the APK, window.HereticNative.triggerMic() drives Android SpeechRecognizer.",
      );
      return;
    }
    const recognition = new Ctor();
    recognition.lang = navigator.language;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      setInput(transcript);
      setLevel(Math.min(1, transcript.length / 60));
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        setListening(false);
        recognition.stop();
      }
    };
    recognition.onerror = (event) => {
      setListening(false);
      toast.push("error", "STT failed", String(event.error ?? "unknown recognizer error"));
    };
    recognition.onend = () => {
      setListening(false);
      setLevel(0);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    toast.push("info", "Listening", "Audio is processed locally and discarded after the utterance.");
  };

  const createConversation = async () => {
    try {
      const { conversation } = await api<{ conversation: ConversationRow }>("/api/conversations", {
        method: "POST",
        json: draft,
      });
      list.setData((prev) => (prev ? { conversations: [conversation, ...prev.conversations] } : prev));
      void list.refetch();
      setActiveId(conversation.id);
      setNewOpen(false);
      setDraft({ title: "", mode: "text", sttEngine: STT_ENGINES[0], voiceEngine: TTS_ENGINES[0] });
      toast.push("success", "Session opened", conversation.title);
    } catch (error) {
      toast.push("error", "Could not open a session", error instanceof Error ? error.message : undefined);
    }
  };

  const send = async (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || !activeId || sending) return;
    if (!activeId) return;

    setSending(true);
    setInput("");
    const tempId = `temp-${Date.now()}`;
    const optimisticUser: MessageRow = {
      id: tempId,
      conversationId: activeId,
      role: "user",
      content,
      intent: null,
      latencyMs: null,
      spoken: false,
      createdAt: new Date().toISOString(),
    };
    setThread((prev) => [...prev, optimisticUser]);

    try {
      const result = await api<{ userMessage: MessageRow; reply: MessageRow; core: CoreMeta }>(
        `/api/conversations/${activeId}/messages`,
        { method: "POST", json: { content } },
      );
      setThread((prev) => [...prev.filter((m) => m.id !== tempId), result.userMessage, result.reply]);
      setMeta(result.core);
      setStreamingId(result.reply.id);
      speak(result.core.speak || result.reply.content.slice(0, 220));
      void list.refetch();
    } catch (error) {
      setThread((prev) => prev.filter((m) => m.id !== tempId));
      setInput(content);
      toast.push("error", "HereticCore did not answer", error instanceof Error ? error.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const removeConversation = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setThread((prev) => prev);
    const snapshot = list.data?.conversations ?? [];
    list.setData({ conversations: snapshot.filter((c) => c.id !== id) });
    if (activeId === id) {
      setActiveId(null);
      setThread([]);
    }
    setPendingDelete(null);
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      toast.push("success", "Session deleted", pendingDelete.title);
      void list.refetch();
    } catch (error) {
      list.setData({ conversations: snapshot });
      toast.push("error", "Delete failed", error instanceof Error ? error.message : undefined);
    }
  };

  const togglePin = async (conversation: ConversationRow) => {
    const snapshot = list.data?.conversations ?? [];
    list.setData({
      conversations: snapshot.map((c) => (c.id === conversation.id ? { ...c, pinned: !c.pinned } : c)),
    });
    try {
      await api(`/api/conversations/${conversation.id}`, { method: "PATCH", json: { pinned: !conversation.pinned } });
      void list.refetch();
    } catch {
      list.setData({ conversations: snapshot });
      toast.push("error", "Could not update the session");
    }
  };

  const activeConversation = list.data?.conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="workflow 01"
        title="Chat & voice pipeline"
        description="STT → HereticCore → TTS, entirely on-device. In a browser the Web Speech API drives the mic; inside the APK window.HereticNative.triggerMic() hands audio to Android SpeechRecognizer."
        right={
          <>
            <Badge tone={nativeBridge ? "mint" : "ember"} dot>
              {nativeBridge ? "HereticNative attached" : "browser fallback"}
            </Badge>
            <Button size="sm" variant="primary" icon={<Plus width={13} height={13} />} onClick={() => setNewOpen(true)}>
              New session
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[19rem_1fr]">
        {/* conversation list */}
        <Panel className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ash2">sessions</p>
            <span className="font-mono text-[10.5px] text-ash2">{list.data?.conversations.length ?? 0}</span>
          </div>
          <div className="max-h-[30rem] overflow-y-auto p-2">
            {list.loading ? (
              <LoadingRows rows={4} className="p-2" />
            ) : list.data?.conversations.length ? (
              list.data.conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className={cn(
                    "group mb-1 rounded-lg border px-3 py-2.5 transition-all",
                    conversation.id === activeId
                      ? "border-ember/40 bg-ember/[0.07]"
                      : "border-transparent hover:border-line2 hover:bg-white/[0.03]",
                  )}
                >
                  <button type="button" className="w-full text-left" onClick={() => setActiveId(conversation.id)}>
                    <p className="flex items-center gap-2 truncate text-[13px] font-medium text-chalk">
                      {conversation.pinned ? <Bolt width={12} height={12} className="shrink-0 text-ember" /> : null}
                      <span className="truncate">{conversation.title}</span>
                    </p>
                    <p className="mt-1 truncate font-mono text-[10.5px] text-ash2">
                      {conversation.turnCount ?? 0} turns · {conversation.mode} · {timeAgo(conversation.updatedAt)}
                    </p>
                    {conversation.lastMessage ? (
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ash2/90">{conversation.lastMessage}</p>
                    ) : null}
                  </button>
                  <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void togglePin(conversation)}
                      className="rounded border border-line2 px-1.5 py-0.5 font-mono text-[10px] text-ash2 transition hover:text-chalk"
                    >
                      {conversation.pinned ? "unpin" : "pin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(conversation)}
                      className="rounded border border-line2 px-1.5 py-0.5 font-mono text-[10px] text-ash2 transition hover:border-rose/40 hover:text-rose"
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon={<WaveIcon width={20} height={20} />}
                title="No sessions yet"
                body="Open a session to talk to HereticCore. Voice mode keeps the transcript flowing through the recognizer."
                action={
                  <Button size="sm" variant="primary" onClick={() => setNewOpen(true)} icon={<Plus width={13} height={13} />}>
                    New session
                  </Button>
                }
              />
            )}
          </div>
        </Panel>

        {/* thread */}
        <Panel className="flex min-h-[36rem] flex-col overflow-hidden">
          <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel2/40 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[14.5px] font-semibold text-chalk">
                {activeConversation?.title ?? "No session selected"}
              </p>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ash2">
                stt {activeConversation?.sttEngine ?? "—"} · tts {activeConversation?.voiceEngine ?? "—"}
              </p>
            </div>
            {meta ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ember">intent {meta.intent}</Badge>
                {meta.confidence > 0 ? <Badge tone="ice">{Math.round(meta.confidence * 100)}% conf</Badge> : null}
                <Badge tone="neutral">{meta.latencyMs} ms</Badge>
              </div>
            ) : null}
          </header>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {threadLoading ? (
              <LoadingRows rows={5} />
            ) : thread.length ? (
              thread.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  streaming={message.id === streamingId}
                  onStreamed={() => setStreamingId(null)}
                />
              ))
            ) : activeId ? (
              <div className="py-8">
                <EmptyState
                  icon={<Terminal width={20} height={20} />}
                  title="Session is empty"
                  body="Ask Heretic something, or tap the mic and speak. Try one of the prompts below the composer."
                />
                <div className="mx-auto flex max-w-xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-line2 bg-panel2/60 px-3 py-1.5 text-[12px] text-ash transition hover:border-ember/45 hover:text-embersoft"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<WaveIcon width={20} height={20} />}
                title="Select or open a session"
                body="Sessions persist in Postgres with every turn, intent and latency recorded by HereticCore."
                action={
                  <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
                    New session
                  </Button>
                }
              />
            )}

            {sending ? (
              <div className="flex gap-3">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ember/40 bg-ember/10 text-ember">
                  <Bolt width={14} height={14} />
                </span>
                <div className="shimmer-pending h-14 flex-1 rounded-lg border border-line bg-panel2/40" />
              </div>
            ) : null}
          </div>

          {/* composer */}
          <div className="border-t border-line bg-panel2/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <Waveform active={listening} level={level} bars={18} />
              <div className="flex-1">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder={listening ? "Listening — speak now…" : "Command Heretic…  (Enter to send, Shift+Enter for a new line)"}
                  className="w-full resize-none rounded-md border border-line2 bg-abyss/80 px-3 py-2 text-[13.5px] text-chalk placeholder:text-ash2/80 focus:border-ember/55 focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={toggleVoice}
                  aria-label={listening ? "Stop listening" : "Start listening"}
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-full border transition",
                    listening
                      ? "border-ember bg-ember/20 text-ember"
                      : "border-line2 bg-panel text-ash hover:border-ember/45 hover:text-embersoft",
                  )}
                >
                  {listening ? <span className="absolute inset-0 animate-pulse-ring rounded-full border border-ember/60" /> : null}
                  <Mic width={17} height={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setSpeakOut((s) => !s)}
                  aria-label={speakOut ? "Mute spoken replies" : "Enable spoken replies"}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border transition",
                    speakOut ? "border-mint/45 bg-mint/10 text-mint" : "border-line2 bg-panel text-ash2 hover:text-chalk",
                  )}
                >
                  <Speaker width={17} height={17} />
                </button>
              </div>
              <Button variant="primary" onClick={() => void send()} loading={sending} disabled={!activeId}>
                Send
              </Button>
            </div>

            {meta?.actions.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ash2">core suggests</span>
                {meta.actions.map((action) => (
                  <a
                    key={action.label}
                    href={action.href.startsWith("/") ? action.href : "#"}
                    className="rounded-full border border-line2 px-3 py-1 font-mono text-[11px] text-ash transition hover:border-ember/45 hover:text-embersoft"
                  >
                    {action.label}
                  </a>
                ))}
                <span className="ml-auto font-mono text-[10.5px] text-ash2">{meta.engine}</span>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Open a new session"
        subtitle="Sessions are local rows; nothing is synced off-device."
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void createConversation()} icon={<Plus width={14} height={14} />}>
              Open session
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title" hint="optional — derived from the first prompt">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Cold boot · mic gate" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Mode">
              <Select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
                <option value="text" className="bg-panel">text</option>
                <option value="voice" className="bg-panel">voice</option>
              </Select>
            </Field>
            <Field label="STT engine">
              <Select value={draft.sttEngine} onChange={(e) => setDraft({ ...draft, sttEngine: e.target.value })}>
                {STT_ENGINES.map((engine) => (
                  <option key={engine} value={engine} className="bg-panel">{engine}</option>
                ))}
              </Select>
            </Field>
            <Field label="TTS engine">
              <Select value={draft.voiceEngine} onChange={(e) => setDraft({ ...draft, voiceEngine: e.target.value })}>
                {TTS_ENGINES.map((engine) => (
                  <option key={engine} value={engine} className="bg-panel">{engine}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this session?"
        body={`“${pendingDelete?.title ?? ""}” and all of its turns will be removed from the workspace.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void removeConversation()}
      />
    </div>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function MessageBubble({
  message,
  streaming,
  onStreamed,
}: {
  message: MessageRow;
  streaming: boolean;
  onStreamed: () => void;
}) {
  if (message.role === "system") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-line bg-abyss/50 px-3 py-2">
        <Terminal width={13} height={13} className="mt-0.5 shrink-0 text-ash2" />
        <p className="font-mono text-[11.5px] leading-relaxed text-ash2">{message.content}</p>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-[10px]",
          isUser ? "border-line2 bg-panel2 text-ash" : "border-ember/40 bg-ember/10 text-ember",
        )}
      >
        {isUser ? "YOU" : "H"}
      </span>
      <div className={cn("min-w-0 max-w-[85%]", isUser && "text-right")}>
        <div
          className={cn(
            "inline-block rounded-lg border px-3.5 py-2.5 text-left",
            isUser ? "border-line2 bg-panel2/70" : "border-ember/20 bg-abyss/70",
          )}
        >
          <p className={cn("whitespace-pre-wrap text-[13.5px] leading-relaxed", isUser ? "text-chalk" : "text-ash")}>
            {streaming ? <TypeOut text={message.content} cps={220} onDone={onStreamed} /> : message.content}
          </p>
        </div>
        <p className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ash2">
          <span>{timeAgo(message.createdAt)}</span>
          {message.intent ? <span className="text-ember/80">{message.intent}</span> : null}
          {message.latencyMs ? <span>{message.latencyMs} ms</span> : null}
          {message.spoken ? (
            <span className="flex items-center gap-1 text-mint">
              <Check width={10} height={10} /> spoken
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
