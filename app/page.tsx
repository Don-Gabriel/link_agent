"use client";

/**
 * The whole control surface: gate, one-time setup, and the dashboard.
 *
 * Two things drive the layout. The approval queue is the primary column
 * because reading a draft properly is the entire point of running in approval
 * mode — so the full text is always expanded, never behind a "read more", and
 * the fold marker shows exactly where LinkedIn will truncate it. Everything
 * that reports state rather than asking for a decision lives in the sidebar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
// Type-only: erased at build time, so this pulls no server code into the bundle.
import type { StyleConfig } from "../lib/style";

// ---------------------------------------------------------------- types

interface Post {
  id: string;
  seq: number;
  text: string;
  hook: string;
  rationale: string;
  status: string;
  kind: string;
  category: string | null;
  scores: Record<string, number> | null;
  sources: string[];
  media: string[];
  hashtags: string[];
  continuity: string | null;
  usedQuote: boolean;
  createdAt: string;
  publishedAt: string | null;
}

interface Status {
  initialized: boolean;
  agent?: {
    agentId: string;
    name: string;
    domain: string;
    categories: string[];
    timezone: string;
    postTimeLocal: string;
    autoPublish: boolean;
    paused: boolean;
    autoPublishCap: number;
    style: StyleConfig;
  };
  account?: {
    connected: boolean;
    memberName?: string;
    daysRemaining?: number;
    expiringSoon?: boolean;
    needsReauth?: boolean;
    hasRefreshToken?: boolean;
    lastError?: string;
  };
  config: {
    liveMode: boolean;
    encryptionKey: boolean;
    memoryDegraded?: boolean;
    maxAutoCap?: number;
    presets?: { id: string; label: string; blurb: string; style: StyleConfig }[];
  };
  budget?: {
    autoUsed: number;
    autoCap: number;
    manualUsed: number;
    manualCap: number;
    linkedinDailyRequests: number;
  };
  schedule?: { nextRunLocal: string | null; cycleCount: number };
  queue?: Post[];
  history?: Post[];
  rejections?: { title: string; url: string; reason: string; createdAt: string }[];
  llm?: { model: string; calls: number; cap: number }[];
  ambiguous?: { seq: number | null; createdAt: string; lastError: string | null }[];
}

// Kept in step with lib/categories.ts by hand. The phone reads this list from
// /api/status instead; this page is the setup-and-OAuth surface, where the
// categories have to render before any status payload has been fetched.
const CATEGORY_LABELS: Record<string, string> = {
  "music-tech-software": "Music tech · software",
  "music-tech-hardware": "Music tech · hardware",
  "emerging-tech": "Emerging tech",
  "ai-ml": "AI & ML engineering",
  "dev-tooling": "Developer tooling",
  "hardware-embedded": "Hardware & embedded",
  "compute-silicon": "Compute & silicon",
};

// The subset pre-selected at init. Deliberately NOT every category: seven
// active at once spreads the daily candidate pool thin across interests the
// author may not actually have, and adding one later is a single tap.
const DEFAULT_CATEGORIES = ["music-tech-software", "music-tech-hardware", "emerging-tech"];

const SCORE_LABELS: Record<string, string> = {
  persona_fit: "persona fit",
  category_fit: "category fit",
  novelty: "novelty",
  timeliness: "timeliness",
  non_duplication: "non-duplication",
};

const FOLD_CHARS = 210;

// ---------------------------------------------------------------- helpers

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
}

/**
 * Shrink an image in the browser before upload. A phone photo is several
 * megabytes and the upload route sits behind a ~4.5MB serverless body cap, so
 * this is load-bearing rather than cosmetic. GIFs pass through untouched —
 * putting one through a canvas would flatten it to a single frame.
 */
async function downscale(file: File, maxDim = 1920, quality = 0.85): Promise<File> {
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2_000_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // never block an upload because the resize failed
  }
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// ---------------------------------------------------------------- page

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/status");
    if (res.status === 401) {
      setLocked(true);
      setLoading(false);
      return;
    }
    setLocked(false);
    if (res.ok) setStatus((await res.json()) as Status);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (loading) return <div className="gate"><p style={{ color: "var(--paper-faint)" }}>Loading…</p></div>;
  if (locked) return <Gate onIn={refresh} />;
  if (!status) return <div className="gate"><p className="error-text">Could not load status.</p></div>;
  if (!status.initialized) return <Setup onDone={refresh} />;

  return <Dashboard status={status} refresh={refresh} />;
}

// ---------------------------------------------------------------- gate

function Gate({ onIn }: { onIn: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await api("/api/auth", { method: "POST", body: JSON.stringify({ password }) });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setError(data.detail ?? (data.error === "invalid_password" ? "Wrong password." : "Login failed."));
      return;
    }
    await onIn();
  }

  return (
    <div className="gate">
      <form className="panel" onSubmit={submit}>
        <h1>LinkedIn agent</h1>
        <p>This dashboard can publish to your profile. Sign in to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
        />
        <div style={{ marginTop: "var(--s3)" }}>
          <button className="primary" type="submit" disabled={busy || password.length === 0}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- setup

function Setup({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
  );
  const [postTime, setPostTime] = useState("09:30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await api("/api/init", {
      method: "POST",
      body: JSON.stringify({ name, categories, timezone, postTimeLocal: postTime }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setError(data.detail ?? data.error ?? "Setup failed.");
      return;
    }
    await onDone();
  }

  return (
    <div className="shell setup">
      <h1 style={{ fontSize: "var(--fs-xl)", margin: "0 0 var(--s2)" }}>Set up your agent</h1>
      <p style={{ color: "var(--paper-faint)", marginTop: 0 }}>
        This runs once. It decides what the agent reads, how it sounds, and when it posts —
        all of it changeable afterwards.
      </p>
      <form className="panel" onSubmit={submit}>
        <label className="field">
          <span>Your name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="How you sign your work" />
        </label>
        {/* There is deliberately no free-text "what you write about" box any
            more. It was the one thing here that could disagree with the
            categories, and it always eventually did: typed once, fed into the
            persona, then never revised when the categories moved underneath it.
            The scope is the categories, so it is only asked for once. */}
        <label className="field">
          <span>What you write about</span>
          <div className="chips">
            {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="chip"
                data-on={categories.includes(id)}
                onClick={() => toggle(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">
            The agent&apos;s voice, its reading list and how it describes itself all come from
            these. Change them whenever you like — it rebuilds itself to match.
          </p>
        </label>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            <span>Daily post time</span>
            <input type="time" value={postTime} onChange={(e) => setPostTime(e.target.value)} />
          </label>
          <label className="field" style={{ flex: "2 1 12rem" }}>
            <span>Timezone</span>
            <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
        </div>
        <button className="primary" type="submit" disabled={busy || name.length < 2 || categories.length === 0}>
          {busy ? "Creating…" : "Create agent"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function Dashboard({ status, refresh }: { status: Status; refresh: () => Promise<void> }) {
  const agent = status.agent!;
  const account = status.account ?? { connected: false };

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>{agent.name}</h1>
          <p className="sub">
            {agent.categories.map((c) => CATEGORY_LABELS[c] ?? c).join(" · ")}
          </p>
        </div>
        <div className="row">
          {status.config.liveMode ? (
            <span className="badge">live</span>
          ) : (
            <span className="badge warn">dry run</span>
          )}
          {agent.paused ? (
            <span className="badge warn">paused</span>
          ) : (
            <span className="badge">running</span>
          )}
          {agent.autoPublish ? (
            <span className="badge warn">publishes itself</span>
          ) : (
            <span className="badge">waits for you</span>
          )}
          <button
            className="ghost"
            onClick={async () => {
              await api("/api/auth", { method: "DELETE" });
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <Alerts status={status} refresh={refresh} />

      <div className="columns" style={{ marginTop: "var(--s5)" }}>
        <div className="stack">
          <Queue posts={status.queue ?? []} refresh={refresh} liveMode={status.config.liveMode} />
          <Composer refresh={refresh} connected={account.connected && !account.needsReauth} />
          <History posts={status.history ?? []} />
        </div>
        <div className="stack sidebar">
          <Connection account={account} refresh={refresh} />
          <Settings agent={agent} refresh={refresh} />
          <Voice agent={agent} presets={status.config.presets ?? []} refresh={refresh} />
          <Schedule status={status} />
          <Rejections items={status.rejections ?? []} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- alerts

function Alerts({ status, refresh }: { status: Status; refresh: () => Promise<void> }) {
  const account = status.account;
  const alerts: React.ReactNode[] = [];

  if (!status.config.encryptionKey) {
    alerts.push(
      <div className="notice bad" key="key">
        <div>
          <strong>TOKEN_ENCRYPTION_KEY is not set</strong>
          <p>LinkedIn cannot be connected until it is — tokens are never stored unencrypted.</p>
        </div>
      </div>,
    );
  }

  if (!status.config.liveMode) {
    alerts.push(
      <div className="notice" key="dry">
        <div>
          <strong>Dry run</strong>
          <p>
            Drafts are written and queued, but nothing reaches LinkedIn. Set{" "}
            <code>LINKEDIN_LIVE=true</code> when you are ready to publish for real.
          </p>
        </div>
      </div>,
    );
  }

  if (account?.needsReauth) {
    alerts.push(
      <div className="notice bad" key="reauth">
        <div>
          <strong>LinkedIn access expired</strong>
          <p>Publishing is paused until you reconnect. Tokens last 60 days and cannot self-renew.</p>
        </div>
        <a href="/api/linkedin/connect"><button className="primary">Reconnect</button></a>
      </div>,
    );
  } else if (account?.expiringSoon) {
    alerts.push(
      <div className="notice warn" key="expiring">
        <div>
          <strong>LinkedIn access expires in {account.daysRemaining} days</strong>
          <p>Reconnect any time before then — it takes one click and nothing is lost.</p>
        </div>
        <a href="/api/linkedin/connect"><button>Reconnect now</button></a>
      </div>,
    );
  }

  for (const item of status.ambiguous ?? []) {
    alerts.push(
      <div className="notice warn" key={`amb-${item.seq}`}>
        <div>
          <strong>Unconfirmed send — p{item.seq}</strong>
          <p>
            LinkedIn never answered, so this was not retried: it may or may not have published.
            Check your profile, then tell it what happened.
          </p>
        </div>
        <div className="row">
          <button
            onClick={async () => {
              await api(`/api/posts/${item.seq}`, {
                method: "PATCH",
                body: JSON.stringify({ action: "resolve", didPublish: true }),
              });
              await refresh();
            }}
          >
            It published
          </button>
          <button
            onClick={async () => {
              await api(`/api/posts/${item.seq}`, {
                method: "PATCH",
                body: JSON.stringify({ action: "resolve", didPublish: false }),
              });
              await refresh();
            }}
          >
            It did not
          </button>
        </div>
      </div>,
    );
  }

  if (alerts.length === 0) return null;
  return <div className="stack" style={{ gap: "var(--s3)" }}>{alerts}</div>;
}

// ---------------------------------------------------------------- composer

interface Attachment {
  id: string;
  preview: string;
  name: string;
}

function Composer({ refresh, connected }: { refresh: () => Promise<void>; connected: boolean }) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState<Attachment[]>([]);
  const [polish, setPolish] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const over = text.length > 2400;

  async function upload(files: FileList | File[]) {
    setError("");
    for (const raw of Array.from(files).slice(0, 9)) {
      setBusy("Uploading image…");
      const file = await downscale(raw);
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string; detail?: string };
      if (!res.ok || !data.id) {
        setError(data.detail ?? data.error ?? "Image upload failed.");
        break;
      }
      setMedia((prev) => [...prev, { id: data.id!, preview: URL.createObjectURL(file), name: file.name }]);
    }
    setBusy(null);
  }

  async function submit(publishNow: boolean) {
    setBusy(publishNow ? "Publishing…" : "Saving…");
    setError("");
    const res = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ text, mediaIds: media.map((m) => m.id), polish, publishNow }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    setBusy(null);
    if (!res.ok) {
      setError(data.detail ?? data.error ?? "Failed.");
      return;
    }
    setText("");
    setMedia([]);
    setPolish(false);
    await refresh();
  }

  return (
    <section className="panel">
      <h2>Write a post</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Something you want to say. The first line is the hook — everything past ~210 characters is hidden behind “see more”."
      />
      <div className="spread" style={{ marginTop: "var(--s2)" }}>
        <span className="counter tabular" data-over={over}>
          {text.length} / 2400
          {text.length > FOLD_CHARS && ` · fold at ${FOLD_CHARS}`}
        </span>
        <button className="ghost" onClick={() => fileInput.current?.click()} disabled={!connected}>
          + image
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/gif"
        multiple
        hidden
        onChange={(e) => e.target.files && void upload(e.target.files)}
      />

      <div
        className="dropzone"
        data-active={dragging}
        style={{ marginTop: "var(--s3)" }}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
      >
        {connected
          ? "Drop images here, or click to choose. They are resized in your browser first."
          : "Connect LinkedIn to attach images."}
      </div>

      {media.length > 0 && (
        <div className="thumbs">
          {media.map((m) => (
            <div className="thumb" key={m.id}>
              {/* Local object URL for a just-picked file; next/image adds nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.preview} alt={m.name} />
              <button onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="toggle" style={{ marginTop: "var(--s3)" }}>
        <div className="label">
          <b>Edit for the hook</b>
          <span>Tightens the opening and strips influencer tics. Keeps your meaning and your facts.</span>
        </div>
        <button className="switch" data-on={polish} onClick={() => setPolish(!polish)} aria-label="Toggle editing" />
      </div>

      <div className="post-actions">
        <button onClick={() => void submit(false)} disabled={!!busy || text.trim().length < 20}>
          Save as draft
        </button>
        <div className="spacer" />
        <button
          className="primary"
          onClick={() => void submit(true)}
          disabled={!!busy || text.trim().length < 20 || over || !connected}
        >
          {busy ?? "Publish now"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- queue

function Queue({
  posts,
  refresh,
  liveMode,
}: {
  posts: Post[];
  refresh: () => Promise<void>;
  liveMode: boolean;
}) {
  return (
    <section className="panel">
      <h2>Awaiting your approval ({posts.length})</h2>
      {posts.length === 0 ? (
        <p className="empty">Nothing queued. The agent drafts once a day, and stays quiet on days when nothing clears the bar.</p>
      ) : (
        posts.map((post) => (
          <PostCard key={post.id} post={post} refresh={refresh} liveMode={liveMode} editable />
        ))
      )}
    </section>
  );
}

/** The judge's overall mark, from the payload or averaged from its criteria. */
function judgeTotal(scores: Record<string, number>): string {
  if (typeof scores.total === "number") return scores.total.toFixed(1);
  const rest = Object.entries(scores).filter(([k]) => k !== "total");
  if (rest.length === 0) return "—";
  return (rest.reduce((a, [, v]) => a + v, 0) / rest.length).toFixed(1);
}

function PostCard({
  post,
  refresh,
  liveMode,
  editable,
}: {
  post: Post;
  refresh: () => Promise<void>;
  liveMode: boolean;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError("");
    const res = await api(`/api/posts/${post.seq}`, {
      method: "PATCH",
      body: JSON.stringify({ action, ...extra }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    setBusy(null);
    if (!res.ok) {
      setError(data.detail ?? data.error ?? "Failed.");
      return;
    }
    setEditing(false);
    await refresh();
  }

  // Show where LinkedIn truncates, so the hook can be judged before publishing.
  const foldIndex = post.text.length > FOLD_CHARS ? post.text.lastIndexOf(" ", FOLD_CHARS) : -1;

  return (
    <article className="post">
      <div className="post-meta">
        <span className="badge">{post.id}</span>
        {post.category && <span className="badge">{CATEGORY_LABELS[post.category] ?? post.category}</span>}
        <span className="badge">{post.kind === "custom" ? "yours" : "agent"}</span>
        {post.usedQuote && <span className="badge live">Marvel line</span>}
        {post.status === "failed" && <span className="badge bad">failed</span>}
        {post.status === "unknown" && <span className="badge warn">unconfirmed</span>}
        {post.media.length > 0 && <span className="badge">{post.media.length} image{post.media.length > 1 ? "s" : ""}</span>}
        <span>{relative(post.createdAt)}</span>
      </div>

      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <>
          {foldIndex > 0 ? (
            <>
              <p className="post-text">{post.text.slice(0, foldIndex)}</p>
              {/* The cut LinkedIn makes at 210 characters, drawn where it
                  falls, with the count of what it hides. Judging the hook
                  against that boundary is the thing this screen does that
                  LinkedIn's own composer does not. */}
              <hr
                className="fold"
                data-below={`see more · ${post.text.length - foldIndex} below`}
              />
              <p className="post-text below-fold">{post.text.slice(foldIndex + 1)}</p>
            </>
          ) : (
            <p className="post-text">{post.text}</p>
          )}
          {post.hashtags.length > 0 && (
            <p className="post-text" style={{ color: "var(--daylight)", marginTop: "var(--s3)" }}>
              {post.hashtags.map((h) => `#${h}`).join(" ")}
            </p>
          )}
        </>
      )}

      {/* The judge's reasoning and its five criteria, folded away together.
          "Why did it pick this" is a question asked occasionally; open under
          every draft, the meters compete with the copy on every read. */}
      {(post.rationale || post.scores) && (
        <details className="judgement">
          <summary>
            Why this one
            {post.scores && <span className="total">{judgeTotal(post.scores)} / 10</span>}
          </summary>

          {post.rationale && <p className="rationale">{post.rationale}</p>}

          {post.scores && (
            <div className="scores">
              {Object.entries(post.scores)
                .filter(([key]) => key !== "total")
                .map(([key, value]) => (
                  <div className="score" key={key}>
                    <span>{SCORE_LABELS[key] ?? key}</span>
                    <span className="meter">
                      <i style={{ width: `${(value / 10) * 100}%` }} />
                    </span>
                    <span className="tabular">{value}</span>
                  </div>
                ))}
            </div>
          )}
        </details>
      )}

      {post.sources[0] && (
        <p className="hint" style={{ marginTop: "var(--s3)" }}>
          <a href={post.sources[0]} target="_blank" rel="noreferrer">
            {new URL(post.sources[0]).hostname}
          </a>
        </p>
      )}

      {editable && (
        <div className="post-actions">
          {editing ? (
            <>
              <button onClick={() => void act("edit", { text: draft, hashtags: post.hashtags })} disabled={!!busy}>
                Save changes
              </button>
              <button className="ghost" onClick={() => { setEditing(false); setDraft(post.text); }}>
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}>Edit</button>
          )}
          <div className="spacer" />
          <button className="danger" onClick={() => void act("discard")} disabled={!!busy}>
            Discard
          </button>
          <button
            className="primary"
            onClick={() => void act("publish")}
            disabled={!!busy || !liveMode || post.status === "unknown"}
            title={liveMode ? undefined : "Dry run — set LINKEDIN_LIVE=true to publish"}
          >
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </article>
  );
}

// ---------------------------------------------------------------- history

function History({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null;
  return (
    <section className="panel">
      <h2>Published ({posts.length})</h2>
      {posts.map((post) => (
        <article className="post" key={post.id}>
          <div className="post-meta">
            <span className="badge good">{post.id}</span>
            {post.category && <span className="badge">{CATEGORY_LABELS[post.category] ?? post.category}</span>}
            <span>{post.publishedAt ? relative(post.publishedAt) : relative(post.createdAt)}</span>
          </div>
          <p className="post-text">{post.text}</p>
        </article>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- sidebar

function Connection({
  account,
  refresh,
}: {
  account: NonNullable<Status["account"]>;
  refresh: () => Promise<void>;
}) {
  return (
    <section className="panel">
      <h2>LinkedIn</h2>
      {account.connected ? (
        <>
          <div className="spread">
            <div>
              <b>{account.memberName ?? "Connected"}</b>
              <p className="hint" style={{ margin: 0 }}>
                Access valid for {account.daysRemaining} more days
                {account.hasRefreshToken ? " · auto-renewing" : " · manual renewal"}
              </p>
            </div>
            <span className={`badge ${account.needsReauth ? "bad" : account.expiringSoon ? "warn" : "good"}`}>
              {account.needsReauth ? "expired" : "connected"}
            </span>
          </div>
          {account.lastError && <p className="error-text">Last error: {account.lastError}</p>}
          <div className="post-actions">
            <a href="/api/linkedin/connect"><button>Reconnect</button></a>
            <div className="spacer" />
            <button
              className="danger"
              onClick={async () => {
                if (!confirm("Disconnect LinkedIn? This also pauses the agent.")) return;
                await api("/api/linkedin/disconnect", { method: "POST" });
                await refresh();
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Not connected. The agent will keep drafting, but nothing can publish.
          </p>
          <a href="/api/linkedin/connect"><button className="primary">Connect LinkedIn</button></a>
        </>
      )}
    </section>
  );
}

function Settings({
  agent,
  refresh,
}: {
  agent: NonNullable<Status["agent"]>;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Controlled, so what you see is always what was actually sent — and it
  // re-syncs whenever the server's value changes underneath it.
  const [time, setTime] = useState(agent.postTimeLocal);
  useEffect(() => setTime(agent.postTimeLocal), [agent.postTimeLocal]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await api("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setError(data.detail ?? data.error ?? "Failed.");
      return;
    }
    await refresh();
  }

  return (
    <section className="panel">
      <h2>Settings</h2>

      <label className="field">
        <span>Categories</span>
        <div className="chips">
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => {
            const on = agent.categories.includes(id);
            return (
              <button
                key={id}
                className="chip"
                data-on={on}
                disabled={busy || (on && agent.categories.length === 1)}
                onClick={() =>
                  void patch({
                    categories: on
                      ? agent.categories.filter((c) => c !== id)
                      : [...agent.categories, id],
                  })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </label>

      <label className="field">
        <span>Daily post time ({agent.timezone})</span>
        <input
          type="time"
          value={time}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value;
            setTime(next);
            // Save as soon as the value is a COMPLETE time. A time input reports
            // every keystroke, including half-entered states that read as "" —
            // saving on blur meant those were sent to the server, silently
            // dropped, and reported as a successful save.
            if (/^\d{2}:\d{2}$/.test(next) && next !== agent.postTimeLocal) {
              void patch({ postTimeLocal: next });
            }
          }}
        />
      </label>

      <div className="toggle">
        <div className="label">
          <b>Publish automatically</b>
          <span>Off means every post waits for you. Turn it on once the voice sounds like you.</span>
        </div>
        <button
          className="switch"
          data-on={agent.autoPublish}
          disabled={busy}
          onClick={() => void patch({ autoPublish: !agent.autoPublish })}
          aria-label="Toggle auto-publish"
        />
      </div>

      <div className="toggle">
        <div className="label">
          <b>Paused</b>
          <span>Stops the daily cycle entirely. Drafts and history are untouched.</span>
        </div>
        <button
          className="switch"
          data-on={agent.paused}
          disabled={busy}
          onClick={() => void patch({ paused: !agent.paused })}
          aria-label="Toggle pause"
        />
      </div>

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- voice

const STRUCTURE_LABELS: Record<string, string> = {
  prose: "Paragraphs",
  bullets: "Bullet list",
  "short-lines": "Short punchy lines",
  mixed: "Lead + bullets",
};
const EMOJI_LABELS: Record<string, string> = {
  none: "None",
  sparing: "Sparing (max 2)",
  expressive: "Expressive",
};
const HOOK_LABELS: Record<string, string> = { plain: "Plain", sharp: "Sharp", bold: "Bold claim" };
const CTA_LABELS: Record<string, string> = {
  none: "No call to action",
  soft: "Soft question",
  direct: "Direct ask",
};
const REGISTER_LABELS: Record<string, string> = {
  practitioner: "Practitioner (peers)",
  peer: "Broad professional",
  accessible: "Plain language",
};

/** The one-line summary shown while the panel is collapsed. */
function voiceSummary(s: StyleConfig): string {
  return [
    STRUCTURE_LABELS[s.structure] ?? s.structure,
    s.emoji === "none" ? "no emoji" : `${s.emoji} emoji`,
    s.hashtagCount === 0 ? "no tags" : `${s.hashtagCount} tags`,
    `${s.minWords}–${s.maxWords} words`,
    s.signature ? `${s.signature.source} line` : "no signature",
  ].join(" · ");
}

/** Textareas edit these as one-per-line; empty lines are dropped. */
function toLines(v: string[]): string {
  return v.join("\n");
}
function fromLines(v: string): string[] {
  return v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface PreviewResult {
  sourceLabel: string;
  before: string;
  after: string;
  hook: string;
  length: { escapedChars: number; withinLimit: boolean };
  servedBy?: string;
}

/**
 * The voice panel. Edits are staged locally and applied with Save, rather than
 * patched per keystroke like the other settings — there are a dozen controls
 * here and they only make sense as a combination, so previewing the whole set
 * before committing is the point.
 */
function Voice({
  agent,
  presets,
  refresh,
}: {
  agent: NonNullable<Status["agent"]>;
  presets: NonNullable<Status["config"]["presets"]>;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<StyleConfig>(agent.style);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // Re-sync whenever the saved style changes underneath us (another tab, a
  // preset applied elsewhere) — but only while closed, so an open editor never
  // loses what the user is typing.
  useEffect(() => {
    if (!open) setDraft(agent.style);
  }, [agent.style, open]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(agent.style);

  function set<K extends keyof StyleConfig>(key: K, value: StyleConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setPreview(null); // a preview of the previous settings is worse than none
  }

  async function save() {
    setBusy(true);
    setError("");
    const res = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ style: draft }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setError(data.detail ?? data.error ?? "Failed to save.");
      return;
    }
    await refresh();
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    const res = await api("/api/style/preview", {
      method: "POST",
      body: JSON.stringify({ style: draft }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as PreviewResult & {
      error?: string;
      detail?: string;
    };
    if (!res.ok) {
      setError(data.detail ?? data.error ?? "Preview failed.");
      return;
    }
    setPreview(data);
  }

  const sig = draft.signature;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Voice</h2>
        <button className="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>
      <p className="sub" style={{ fontSize: "var(--fs-micro)", margin: 0 }}>
        {voiceSummary(agent.style)}
      </p>

      {open && (
        <div style={{ marginTop: "var(--s4)" }}>
          <label className="field">
            <span>Start from a preset</span>
            <div className="chips">
              {presets.map((p) => (
                <button
                  key={p.id}
                  className="chip"
                  title={p.blurb}
                  disabled={busy}
                  onClick={() => {
                    setDraft(p.style);
                    setPreview(null);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Structure</span>
            <select
              value={draft.structure}
              disabled={busy}
              onChange={(e) => set("structure", e.target.value as StyleConfig["structure"])}
            >
              {Object.entries(STRUCTURE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Emoji</span>
            <select
              value={draft.emoji}
              disabled={busy}
              onChange={(e) => set("emoji", e.target.value as StyleConfig["emoji"])}
            >
              {Object.entries(EMOJI_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Opening line</span>
            <select
              value={draft.hook}
              disabled={busy}
              onChange={(e) => set("hook", e.target.value as StyleConfig["hook"])}
            >
              {Object.entries(HOOK_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Closing</span>
            <select
              value={draft.cta}
              disabled={busy}
              onChange={(e) => set("cta", e.target.value as StyleConfig["cta"])}
            >
              {Object.entries(CTA_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Written for</span>
            <select
              value={draft.register}
              disabled={busy}
              onChange={(e) => set("register", e.target.value as StyleConfig["register"])}
            >
              {Object.entries(REGISTER_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>

          <div className="row" style={{ gap: "var(--s3)" }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Min words</span>
              <input
                type="number"
                min={40}
                max={400}
                value={draft.minWords}
                disabled={busy}
                onChange={(e) => set("minWords", Number(e.target.value))}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Max words</span>
              <input
                type="number"
                min={60}
                max={500}
                value={draft.maxWords}
                disabled={busy}
                onChange={(e) => set("maxWords", Number(e.target.value))}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Hashtags</span>
              <input
                type="number"
                min={0}
                max={5}
                value={draft.hashtagCount}
                disabled={busy}
                onChange={(e) => set("hashtagCount", Number(e.target.value))}
              />
            </label>
          </div>

          <div className="toggle">
            <div className="label">
              <b>Signature line</b>
              <span>A rationed catchphrase — at most one short quote, and not in every post.</span>
            </div>
            <button
              className="switch"
              data-on={!!sig}
              disabled={busy}
              aria-label="Toggle signature line"
              onClick={() =>
                set(
                  "signature",
                  sig
                    ? null
                    : { source: "Marvel films", maxWords: 12, budgetPerFive: 1, banned: [] },
                )
              }
            />
          </div>

          {sig && (
            <>
              <label className="field">
                <span>Quotes drawn from</span>
                <input
                  type="text"
                  value={sig.source}
                  disabled={busy}
                  placeholder="Marvel films"
                  onChange={(e) => set("signature", { ...sig, source: e.target.value })}
                />
              </label>
              <label className="field">
                <span>At most this many per 5 posts</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={sig.budgetPerFive}
                  disabled={busy}
                  onChange={(e) =>
                    set("signature", { ...sig, budgetPerFive: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Overused lines to never quote (one per line)</span>
                <textarea
                  className="compact"
                  rows={3}
                  value={toLines(sig.banned)}
                  disabled={busy}
                  onChange={(e) => set("signature", { ...sig, banned: fromLines(e.target.value) })}
                />
              </label>
            </>
          )}

          <label className="field">
            <span>Banned phrases (one per line)</span>
            <textarea
              className="compact"
              rows={4}
              value={toLines(draft.bannedPhrases)}
              disabled={busy}
              onChange={(e) => set("bannedPhrases", fromLines(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Your own rules (one per line)</span>
            <textarea
              className="compact"
              rows={3}
              value={toLines(draft.customRules)}
              disabled={busy}
              placeholder={"Never mention my employer by name\nAlways name the tool version"}
              onChange={(e) => set("customRules", fromLines(e.target.value))}
            />
          </label>

          <div className="row" style={{ gap: "var(--s2)", marginTop: "var(--s3)" }}>
            <button className="ghost" disabled={busy} onClick={() => void runPreview()}>
              {busy ? "Working…" : "Preview"}
            </button>
            <button disabled={busy || !dirty} onClick={() => void save()}>
              {dirty ? "Save voice" : "Saved"}
            </button>
            {dirty && (
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(agent.style);
                  setPreview(null);
                }}
              >
                Revert
              </button>
            )}
          </div>

          {preview && (
            <div className="preview">
              <p className="sub" style={{ fontSize: "var(--fs-micro)" }}>
                Rewritten from {preview.sourceLabel}
                {preview.servedBy ? ` · ${preview.servedBy}` : ""} ·{" "}
                {preview.length.escapedChars} chars
                {preview.length.withinLimit ? "" : " · TOO LONG"}
              </p>
              <p className="post-text">{preview.after}</p>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </section>
  );
}

function Schedule({ status }: { status: Status }) {
  return (
    <section className="panel">
      <h2>Cadence</h2>
      <ul className="list-compact">
        <li>
          Next run
          <span className="why">{status.schedule?.nextRunLocal ?? "not scheduled"}</span>
        </li>
        <li>
          Cycles run
          <span className="why tabular">{status.schedule?.cycleCount ?? 0}</span>
        </li>
        <li>
          Agent publishes
          <span className="why tabular">
            {status.budget?.autoUsed ?? 0} / {status.budget?.autoCap ?? 1} today
          </span>
        </li>
        <li>
          You published
          <span className="why tabular">
            {status.budget?.manualUsed ?? 0} today
          </span>
        </li>
        {(status.llm ?? []).map((m) => (
          <li key={m.model}>
            {m.model}
            <span className="why tabular">
              {m.calls} / {m.cap} calls today
            </span>
          </li>
        ))}
        {status.config.memoryDegraded && (
          <li>
            Graph memory
            <span className="why">degraded — using local fingerprints instead</span>
          </li>
        )}
      </ul>
    </section>
  );
}

function Rejections({ items }: { items: NonNullable<Status["rejections"]> }) {
  if (items.length === 0) return null;
  return (
    <section className="panel">
      <h2>Passed over</h2>
      <ul className="list-compact">
        {items.slice(0, 8).map((r) => (
          <li key={`${r.url}-${r.createdAt}`}>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title}
            </a>
            <span className="why">{r.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
