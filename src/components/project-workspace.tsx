"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  ModelChoice,
  ProjectDetail,
  TimelineEvent,
} from "../shared/projects";
const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
export function ProjectWorkspace({
  id,
  choice,
}: {
  id: string;
  choice: ModelChoice | undefined;
}) {
  const [detail, setDetail] = useState<ProjectDetail>();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pane, setPane] = useState<"preview" | "code" | "history">("preview");
  const [device, setDevice] = useState("100%");
  const [files, setFiles] = useState<Record<string, string>>({});
  const [file, setFile] = useState("app/page.tsx");
  const [dirty, setDirty] = useState(false);
  const [connection, setConnection] = useState("");
  const revision = useRef<string | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${id}`);
      if (!r.ok) throw new Error("Could not load this project.");
      const data: ProjectDetail = await r.json();
      setDetail(data);
      if (revision.current !== data.project.activeRevision) {
        revision.current = data.project.activeRevision;
        setFiles(data.files);
        setDirty(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load project.");
    }
  }, [id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  const jobId = detail?.jobs[0]?.id;
  useEffect(() => {
    if (!jobId) return;
    setEvents([]);
    setConnection("Connected");
    const stream = new EventSource(`/api/jobs/${jobId}/events`);
    stream.onmessage = (message) => {
      const event: TimelineEvent = JSON.parse(message.data);
      setEvents((previous) =>
        previous.some((p) => p.id === event.id)
          ? previous
          : [...previous, event].slice(-200),
      );
    };
    stream.onerror = () => setConnection("Reconnecting… events will replay.");
    stream.onopen = () => setConnection("Connected");
    stream.addEventListener("end", () => {
      stream.close();
      setConnection("Saved");
      void load();
    });
    return () => stream.close();
  }, [jobId, load]);
  const busy =
    submitting ||
    !!detail?.jobs.some((j) => j.status === "queued" || j.status === "running");
  async function queue(body: unknown) {
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`/api/projects/${id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setFollowUp("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue change.");
    } finally {
      setSubmitting(false);
    }
  }
  if (!detail)
    return (
      <div className="workbench">
        <p role="status">{error || "Opening your project…"}</p>
      </div>
    );
  const allFiles = { ...detail.protectedFiles, ...files };
  const latest = events.filter((e) => e.type !== "log").at(-1);
  const activeProvider = events
    .filter((e) => e.type === "provider")
    .at(-1)?.message;
  const latestGeneration = detail.jobs.find((job) => job.kind === "generate");
  const nextChoice =
    latestGeneration &&
    ["gemini", "groq", "ollama", "openrouter"].includes(
      latestGeneration.provider,
    )
      ? {
          provider: latestGeneration.provider as ModelChoice["provider"],
          model: latestGeneration.model,
        }
      : choice;
  return (
    <div className="workbench">
      <div className="workbench-heading">
        <div>
          <span className="eyebrow">YOUR PROJECT</span>
          <h1>{detail.project.name}</h1>
          <p className="active-model">
            {activeProvider ??
              (detail.jobs[0]?.kind === "generate"
                ? `${detail.jobs[0].provider} / ${detail.jobs[0].model}`
                : detail.jobs[0]?.kind === "restore"
                  ? "Restored revision · Local build"
                  : "Code revision · Local build")}
          </p>
        </div>
        <span className="run-badge">
          <span className={`status-dot ${busy ? "amber" : ""}`} />
          {busy
            ? "Working"
            : detail.previewReady
              ? "Preview live"
              : "Preview paused"}
        </span>
      </div>
      <div className="workbench-body">
        <aside className="conversation">
          <h2>
            Build conversation <small>{connection}</small>
          </h2>
          <div className="prompt-history">
            {detail.jobs
              .filter((j) => j.prompt)
              .slice(0, 3)
              .reverse()
              .map((j) => (
                <div key={j.id} className="user-message">
                  {j.prompt}
                </div>
              ))}
          </div>
          <div className="generation-timeline" aria-label="Generation timeline">
            {events
              .filter((e) => e.type !== "log" && e.type !== "progress")
              .map((e) => (
                <p
                  key={e.id}
                  className={e.type === "error" ? "event-error" : ""}
                >
                  <span>
                    {e.type === "complete"
                      ? "✓"
                      : e.type === "error"
                        ? "!"
                        : "·"}
                  </span>
                  {e.message}
                </p>
              ))}
          </div>
          <p role="status" className="current-status">
            {latest?.message ??
              (busy
                ? "Waiting for the worker…"
                : "Ready for your next change.")}
          </p>
          <form
            className="follow-up"
            onSubmit={(e) => {
              e.preventDefault();
              if (nextChoice)
                void queue({
                  kind: "generate",
                  prompt: followUp,
                  ...nextChoice,
                });
            }}
          >
            <label htmlFor="follow-up">Refine your app</label>
            {nextChoice && (
              <p className="active-model">
                Next change: {nextChoice.provider} / {nextChoice.model}
              </p>
            )}
            <textarea
              id="follow-up"
              placeholder="Make it a little more…"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              maxLength={12000}
              disabled={busy}
            />
            <button
              className="build-button"
              disabled={busy || !nextChoice || followUp.trim().length < 5}
            >
              Apply change ↗
            </button>
          </form>
          {error && (
            <p className="event-error" role="alert">
              {error}
            </p>
          )}
        </aside>
        <section className="project-panel" aria-label="Generated application">
          <div className="panel-toolbar">
            <div className="panel-tabs">
              {(["preview", "code", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  aria-pressed={pane === tab}
                  onClick={() => setPane(tab)}
                >
                  {tab === "preview"
                    ? "Preview"
                    : tab === "code"
                      ? "Code"
                      : "History"}
                </button>
              ))}
            </div>
            {pane === "code" && (
              <button
                className="save-button"
                disabled={!dirty || busy}
                onClick={() => void queue({ kind: "edit", files })}
              >
                {dirty ? "Save & rebuild" : "Saved"}
              </button>
            )}
          </div>
          {pane === "preview" && (
            <>
              <div className="preview-controls">
                <span>ISOLATED LOCAL PREVIEW</span>
                <div>
                  {[
                    ["100%", "Desktop"],
                    ["768px", "Tablet"],
                    ["375px", "Mobile"],
                  ].map(([width, label]) => (
                    <button
                      key={width}
                      aria-pressed={device === width}
                      onClick={() => setDevice(width)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {detail.previewReady ? (
                <div className="preview-stage">
                  <iframe
                    key={detail.project.activeRevision}
                    title="Generated application preview"
                    src={`${detail.previewUrl}/?revision=${detail.project.activeRevision}`}
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    referrerPolicy="no-referrer"
                    style={{ width: device }}
                  />
                </div>
              ) : (
                <div className="preview-empty">
                  <span>✳</span>
                  <h2>
                    {busy
                      ? "Your idea is taking shape."
                      : "Your preview is paused."}
                  </h2>
                  <p>
                    {busy
                      ? "Follow the timeline while Forge validates and builds your application."
                      : "Restore a saved revision to start its preview."}
                  </p>
                  {!busy && detail.project.activeRevision && (
                    <button
                      className="provider-test"
                      onClick={() =>
                        void queue({
                          kind: "restore",
                          revisionId: detail.project.activeRevision,
                        })
                      }
                    >
                      Resume preview
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {pane === "code" && (
            <div className="code-pane">
              <nav className="file-tree" aria-label="Project files">
                {Object.keys(allFiles)
                  .sort()
                  .map((path) => (
                    <button
                      key={path}
                      className={file === path ? "selected" : ""}
                      onClick={() => setFile(path)}
                      title={path}
                    >
                      {path}
                      <small>{path in files ? "" : "read only"}</small>
                    </button>
                  ))}
              </nav>
              <div className="editor-pane">
                <div className="file-caption">
                  {file}
                  {dirty && <span>Unsaved changes</span>}
                </div>
                <CodeEditor
                  path={file}
                  value={allFiles[file] ?? ""}
                  readOnly={busy || !(file in files)}
                  onChange={(value) => {
                    setFiles((previous) => ({ ...previous, [file]: value }));
                    setDirty(true);
                  }}
                />
              </div>
            </div>
          )}
          {pane === "history" && (
            <div className="history-pane">
              <h2>Every working version, kept.</h2>
              <p>
                Restore source and the data snapshot together. Your current
                version stays in history.
              </p>
              {detail.history.length === 0 && (
                <p>Your first successful build will appear here.</p>
              )}
              {detail.history.map((v, i) => (
                <article key={v.id}>
                  <span className="revision-number">
                    {String(detail.history.length - i).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{v.summary}</strong>
                    <small>{new Date(v.createdAt).toLocaleString()}</small>
                  </div>
                  <button
                    className="provider-test"
                    disabled={busy || v.id === detail.project.activeRevision}
                    onClick={() =>
                      void queue({ kind: "restore", revisionId: v.id })
                    }
                  >
                    {v.id === detail.project.activeRevision
                      ? "Current"
                      : "Restore"}
                  </button>
                </article>
              ))}
            </div>
          )}
          <details className="build-logs">
            <summary>
              Build logs <span>{busy ? "Streaming" : "Saved output"}</span>
            </summary>
            <pre>
              {events
                .filter((e) => e.type === "log")
                .map((e) => e.message)
                .join("\n") ||
                "Build output will appear here when installation starts."}
            </pre>
          </details>
        </section>
      </div>
    </div>
  );
}
