"use client";
import { useEffect, useState } from "react";
import { ProjectWorkspace } from "./project-workspace";
import type { ModelChoice, ProjectSummary } from "../shared/projects";
import type { ProviderStatus } from "../shared/providers";
import { ProviderPanel } from "./provider-panel";

const starters = [
  {
    title: "A quieter team inbox",
    text: "Build a customer support inbox with searchable conversations, priority labels, and a customer detail view.",
    icon: "↗",
  },
  {
    title: "Your next side project",
    text: "Build a personal project tracker with a board, due dates, and a weekly progress summary.",
    icon: "◇",
  },
  {
    title: "Something entirely yours",
    text: "Build a reading journal with book notes, a reading list, and a searchable library.",
    icon: "✳",
  },
];
export function Workspace() {
  const [prompt, setPrompt] = useState("");
  const [view, setView] = useState<"workspace" | "providers">("workspace");
  const [projectId, setProjectId] = useState<string>();
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [choice, setChoice] = useState<ModelChoice>();
  const [ready, setReady] = useState<{ worker: boolean; message: string }>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  async function refreshProjects() {
    const response = await fetch("/api/projects");
    if (response.ok) setProjectList(await response.json());
  }
  function openProject(id?: string) {
    setProjectId(id);
    setView("workspace");
    window.history.replaceState(null, "", id ? `/?project=${id}` : "/");
  }
  useEffect(() => {
    const selected = new URL(window.location.href).searchParams.get("project");
    if (selected && /^[a-f0-9-]{36}$/.test(selected)) setProjectId(selected);
    void refreshProjects().catch(() => {});
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: ProviderStatus[]) => {
        if (!Array.isArray(data)) return;
        setProviders(data);
        const selected =
          data.find((p) => p.id === "gemini" && p.available) ??
          data.find((p) => p.id === "openrouter" && p.available) ??
          data.find((p) => p.id === "ollama" && p.available);
        if (selected?.selectedModel)
          setChoice({
            provider: selected.id as "gemini" | "ollama" | "openrouter",
            model: selected.selectedModel,
          });
      })
      .catch(() => {});
    const refresh = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then(setReady)
        .catch(() =>
          setReady({ worker: false, message: "Local runtime is unavailable." }),
        );
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  async function startBuild() {
    if (!choice || !ready?.worker || prompt.trim().length < 20 || creating)
      return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...choice }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refreshProjects();
      openProject(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start generation.");
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Forge AI home">
          <img src="/brand/mark.svg" alt="" width="30" height="30" />
          <span>
            forge<span className="brand-dot">.</span>
          </span>
          <small>LOCAL</small>
        </a>
        <div className="nav-label">YOUR STUDIO</div>
        <nav aria-label="Main navigation">
          <button
            className={view === "workspace" ? "nav-item active" : "nav-item"}
            onClick={() => openProject()}
            aria-current={view === "workspace" ? "page" : undefined}
          >
            <span>▧</span> Workspace
          </button>
          <button
            className={view === "providers" ? "nav-item active" : "nav-item"}
            onClick={() => setView("providers")}
            aria-current={view === "providers" ? "page" : undefined}
          >
            <span>◎</span> Providers
          </button>
        </nav>
        <div className="sidebar-empty">
          <span className="nav-label">PROJECTS</span>
          {projectList.length ? (
            <div className="project-list">
              {projectList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProject(p.id)}
                  className={projectId === p.id ? "selected" : ""}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <p>
              Your first project
              <br />
              starts with an idea.
            </p>
          )}
        </div>
        <div className="local-note">
          <span className="status-dot" /> A space of your own
          <p>
            Local workspace. Your files.
            <br />
            Your choice of model.
          </p>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">F</span>
          <span>
            Personal workspace<small>Developer preview</small>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Personal <span className="slash">/</span>{" "}
            <strong>
              {view === "workspace"
                ? projectId
                  ? "Project workspace"
                  : "New project"
                : "Providers"}
            </strong>
          </span>
          <span className="topbar-status">
            <span className="status-dot" /> Local first{" "}
            <span className="version">v0.2</span>
          </span>
        </header>
        {projectList.length > 0 && (
          <select
            className="mobile-projects"
            aria-label="Saved projects"
            value={projectId ?? ""}
            onChange={(e) => openProject(e.target.value || undefined)}
          >
            <option value="">New project</option>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <main id="main" tabIndex={-1}>
          {view === "workspace" && projectId ? (
            <ProjectWorkspace key={projectId} id={projectId} choice={choice} />
          ) : view === "workspace" ? (
            <div className="launchpad">
              <div className="intro">
                <div className="eyebrow">
                  <span className="tiny-cross">✳</span> FROM A SPARK TO
                  SOMETHING REAL
                </div>
                <h1>
                  What will you
                  <br />
                  <span>make possible?</span>
                </h1>
                <p>
                  Give your idea a place to start.
                  <br className="mobile-break" /> Shape it, build it, make it
                  yours.
                </p>
              </div>
              <section
                className="composer"
                aria-label="New project prompt"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void startBuild();
                  }
                }}
              >
                <div className="composer-heading">
                  <span className="composer-label">THE STARTING POINT</span>
                  <span className="mono muted">01 / BUILD</span>
                </div>
                <label className="sr-only" htmlFor="prompt">
                  Describe your application
                </label>
                <textarea
                  id="prompt"
                  placeholder="An app for…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={12000}
                />
                <div className="composer-meta">
                  <span>
                    Next.js <span className="plus">+</span> SQLite
                  </span>
                  <span>{prompt.length.toLocaleString()} / 12,000</span>
                </div>
                <div className="composer-actions">
                  {choice ? (
                    <select
                      className="provider-pill model-choice"
                      aria-label="Generation model"
                      value={JSON.stringify(choice)}
                      onChange={(e) => setChoice(JSON.parse(e.target.value))}
                    >
                      {providers
                        .filter((p) => p.available)
                        .flatMap((p) =>
                          p.models
                            .filter(
                              (m) =>
                                p.id !== "gemini" || m.id === p.selectedModel,
                            )
                            .map((m) => (
                              <option
                                key={p.id + m.id}
                                value={JSON.stringify({
                                  provider: p.id,
                                  model: m.id,
                                })}
                              >
                                {p.name} / {m.name}
                              </option>
                            )),
                        )}
                    </select>
                  ) : (
                    <button
                      className="provider-pill"
                      onClick={() => setView("providers")}
                    >
                      Configure a provider
                    </button>
                  )}
                  <button
                    className="build-button"
                    disabled={
                      !choice ||
                      !ready?.worker ||
                      prompt.trim().length < 20 ||
                      creating
                    }
                    onClick={() => void startBuild()}
                  >
                    {creating ? "Creating…" : "Build project"} <span>↗</span>
                  </button>
                </div>
              </section>
              <p className="availability" role="status">
                <span>◌</span>
                {ready?.worker
                  ? "Ready to build. Your app will run in an isolated local workspace."
                  : (ready?.message ?? "Checking the local runtime…")}
              </p>
              {error && (
                <p role="alert" className="event-error">
                  {error}
                </p>
              )}
              <section className="starters" aria-labelledby="starters-heading">
                <div className="section-heading">
                  <h2 id="starters-heading">A little inspiration</h2>
                  <span>MAKE IT YOUR OWN</span>
                </div>
                <div className="starter-grid">
                  {starters.map((s) => (
                    <button
                      key={s.title}
                      className="starter"
                      onClick={() => {
                        setPrompt(s.text);
                        document.getElementById("prompt")?.focus();
                      }}
                    >
                      <span className="starter-icon">{s.icon}</span>
                      <strong>{s.title}</strong>
                      <span>
                        Start with this idea <b>↗</b>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <footer className="workspace-footer">
                <span>THINK IT. SHAPE IT. SHIP IT.</span>
                <span>Built in the open. Made for your ideas.</span>
              </footer>
            </div>
          ) : (
            <div className="launchpad providers-view">
              <div className="eyebrow">YOUR MODELS, YOUR WORKSPACE</div>
              <h1>
                Choose your
                <br />
                <span>thinking partner.</span>
              </h1>
              <p className="provider-intro">
                Discover available models and test a live connection.
                Credentials stay on the server.
              </p>
              <ProviderPanel />
              <button
                className="text-button"
                onClick={() => setView("workspace")}
              >
                ← Back to workspace
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
