import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Paperclip,
  Send,
  Square,
  Trash2,
  Sparkles,
} from "lucide-react";
import type { ChatMessage, Conversation, Measurement } from "../types";
import type { Workspace } from "../useWorkspace";
import {
  getAssistantStatus,
  measurementContext,
  streamAssistant,
} from "../services/assistant";
import { deleteConversation, saveConversation } from "../services/cloud";
import { Busy, Notice, PageHeading, type Translate } from "./ui";
import { getArticles } from "../content";
import type { Locale } from "../i18n";
export function Assistant({
  t,
  w,
  context,
  learn,
  date,
  locale,
}: {
  t: Translate;
  w: Workspace;
  context: Measurement | null;
  learn: (id: string) => void;
  date: (s: string) => string;
  locale: Locale;
}) {
  const [available, setAvailable] = useState<boolean | null>(null),
    [text, setText] = useState(""),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [attached, setAttached] = useState(false),
    [selected, setSelected] = useState(context?.id || "");
  const [conversation, setConversation] = useState<Conversation>({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: "",
    language: w.profile.preferences.language,
    messages: [],
  });
  const controller = useRef<AbortController | null>(null),
    end = useRef<HTMLDivElement>(null),
    mounted = useRef(true),
    activeToken = useRef(0);
  const prefs = w.profile.preferences,
    selectedRecord = w.measurements.find((m) => m.id === selected) || null;
  const currentPreference = useRef({
    saveChat: prefs.saveChat,
    user: w.session?.user.id,
  });
  currentPreference.current = {
    saveChat: prefs.saveChat,
    user: w.session?.user.id,
  };
  useEffect(() => {
    mounted.current = true;
    let done = false;
    void getAssistantStatus()
      .then((status) => {
        if (!done) setAvailable(status.assistantAvailable);
      })
      .catch(() => {
        if (!done) setAvailable(false);
      });
    return () => {
      done = true;
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [messages.length, busy]);
  useEffect(() => {
    if (context) {
      setSelected(context.id);
      setAttached(false);
    }
  }, [context?.id]);
  async function save(rows: ChatMessage[]) {
    if (
      !mounted.current ||
      !w.session ||
      !currentPreference.current.saveChat ||
      currentPreference.current.user !== w.session.user.id
    )
      return;
    const next = {
      ...conversation,
      title: rows.find((m) => m.role === "user")?.content.slice(0, 70) || "",
      language: prefs.language,
      messages: rows,
    };
    try {
      await saveConversation(next);
      if (mounted.current) {
        setConversation(next);
        w.setConversations((old) => [
          next,
          ...old.filter((c) => c.id !== next.id),
        ]);
      }
    } catch {
      if (mounted.current) setError("error.save");
    }
  }
  async function send(prompt = text, retry = false) {
    if (!prompt.trim() || busy) return;
    if (prompt.length > 2000) {
      setError("error.tooLong");
      return;
    }
    setError(null);
    setText("");
    setBusy(true);
    const token = ++activeToken.current;
    const prior = retry
      ? messages.slice(
          0,
          messages.length -
            1 -
            [...messages].reverse().findIndex((m) => m.role === "user"),
        )
      : messages;
    const user: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt.trim(),
        createdAt: new Date().toISOString(),
      },
      answer: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      };
    const next = [...prior, user];
    setMessages([...next, answer]);
    const abort = new AbortController();
    controller.current = abort;
    let content = "";
    try {
      const attachedRecord = attached ? selectedRecord : null;
      await streamAssistant(
        {
          messages: next
            .slice(-12)
            .map(({ role, content }) => ({ role, content })),
          language: prefs.language,
          ...(attachedRecord
            ? w.session
              ? { measurementId: attachedRecord.id }
              : { context: measurementContext(attachedRecord) }
            : {}),
        },
        {
          signal: abort.signal,
          onChunk: (delta) => {
            content += delta.replace(/\u2014/g, ", ");
            if (mounted.current && token === activeToken.current)
              setMessages([...next, { ...answer, content }]);
          },
        },
      );
      if (mounted.current && token === activeToken.current)
        await save([...next, { ...answer, content }]);
    } catch (e) {
      if (mounted.current && token === activeToken.current) {
        const code = (e as { code?: string }).code;
        setError(
          code === "rate_limited" ? "assistant.limit" : "assistant.error",
        );
      }
    } finally {
      if (mounted.current && token === activeToken.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  function clear() {
    activeToken.current++;
    controller.current?.abort();
    setBusy(false);
    setMessages([]);
    setError(null);
    setAttached(false);
    setConversation({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      title: "",
      language: prefs.language,
      messages: [],
    });
  }
  const prompts = [
    "assistant.promptCalibrate",
    "assistant.promptBaseline",
    "assistant.promptSession",
    "assistant.promptGraphs",
    "assistant.promptNoise",
  ] as const;
  return (
    <>
      <PageHeading
        eyebrow={`04 / ${t("nav.assistant")}`}
        title={t("assistant.title")}
        description={t("assistant.description")}
        action={
          <button className="secondary" onClick={clear}>
            <Trash2 size={17} />
            {t("assistant.clear")}
          </button>
        }
      />
      <div className="assistant-layout">
        <section className="conversation-panel">
          {available === null && <Busy label={t("common.loading")} />}
          {available === false && (
            <Notice>
              {t("assistant.unavailable")}
              <button
                className="guide-link"
                onClick={() => learn("personal-baseline")}
              >
                <BookOpen size={17} />
                {t("overview.shortcut")}
                <ArrowRight size={17} />
              </button>
            </Notice>
          )}
          <div
            className="messages"
            role="log"
            aria-busy={busy}
            aria-label={t("nav.assistant")}
            aria-live="polite"
          >
            {!messages.length ? (
              <div className="chat-welcome">
                <Sparkles size={34} />
                <h2>{t("app.subtitle")}</h2>
                <div className="starter-prompts">
                  {prompts.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setText(t(p));
                      }}
                    >
                      {t(p)}
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  <span className="eyebrow">
                    {message.role === "assistant"
                      ? "NeuroFront"
                      : w.profile.displayName || t("common.guest")}
                  </span>
                  <p>
                    {message.content ||
                      (busy ? (
                        <Busy label={t("assistant.thinking")} />
                      ) : (
                        t("assistant.error")
                      ))}
                  </p>
                </div>
              ))
            )}
            <div ref={end} />
          </div>
          {error && (
            <Notice kind="error">
              {t(error as "assistant.error")}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (error === "error.save") {
                    void save(messages);
                    return;
                  }
                  const last = [...messages]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (last) void send(last.content, true);
                }}
              >
                {t("assistant.retry")}
              </button>
            </Notice>
          )}
          {attached && selectedRecord && (
            <div className="attachment">
              <Paperclip size={16} />
              {t("assistant.attached")}: {date(selectedRecord.createdAt)}
              <button
                className="text-button"
                onClick={() => setAttached(false)}
              >
                {t("assistant.detach")}
              </button>
            </div>
          )}
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="assistant-input">
              {t("assistant.placeholder")}
            </label>
            <textarea
              id="assistant-input"
              rows={2}
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("assistant.placeholder")}
            />
            {busy ? (
              <button
                type="button"
                className="primary"
                onClick={() => controller.current?.abort()}
              >
                <Square size={17} />
                {t("assistant.stop")}
              </button>
            ) : (
              <button
                className="primary"
                disabled={!text.trim() || available !== true}
              >
                <Send size={17} />
                {t("assistant.send")}
              </button>
            )}
          </form>
          <p className="micro">{t("assistant.safety")}</p>
        </section>
        <aside className="assistant-tools">
          <h2>{t("assistant.attach")}</h2>
          <p>{t("assistant.attachmentHint")}</p>
          <label>
            {t("overview.latest")}
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setAttached(false);
              }}
            >
              <option value="">{t("common.none")}</option>
              {w.measurements
                .filter((m) => !w.session || w.saveStates[m.id] === "saved")
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {date(m.createdAt)}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="secondary full"
            aria-pressed={attached}
            disabled={
              !selectedRecord ||
              (!!w.session && w.saveStates[selectedRecord.id] !== "saved") ||
              busy
            }
            onClick={() => setAttached(!attached)}
          >
            <Paperclip size={17} />
            {t(attached ? "assistant.detach" : "assistant.attach")}
          </button>
          {w.session && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={prefs.saveChat}
                onChange={(e) =>
                  w.preferences({ ...prefs, saveChat: e.target.checked })
                }
              />
              {t("assistant.savePreference")}
            </label>
          )}
          <p className="micro">{t("assistant.localNotice")}</p>
          {w.session && (
            <>
              <h3>{t("assistant.conversations")}</h3>
              {w.conversations.length ? (
                w.conversations.map((c) => (
                  <div key={c.id} className="conversation-link">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setMessages(c.messages);
                        setConversation(c);
                        setAttached(false);
                        setError(null);
                      }}
                    >
                      {c.title}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t("common.delete")}
                      onClick={() => {
                        if (confirm(t("common.confirmDelete")))
                          void deleteConversation(c.id)
                            .then(() => {
                              if (mounted.current)
                                w.setConversations((rows) =>
                                  rows.filter((r) => r.id !== c.id),
                                );
                            })
                            .catch(() => {
                              if (mounted.current) setError("error.save");
                            });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="micro">{t("assistant.emptySaved")}</p>
              )}
            </>
          )}
          <h3>{t("learn.related")}</h3>
          {getArticles(locale)
            .filter((a) =>
              [
                "personal-baseline",
                "signal-quality",
                "comparing-baseline",
              ].includes(a.id),
            )
            .map((a) => (
              <button
                className="guide-link"
                key={a.id}
                onClick={() => learn(a.id)}
              >
                {a.title}
                <ArrowRight size={16} />
              </button>
            ))}
        </aside>
      </div>
    </>
  );
}
