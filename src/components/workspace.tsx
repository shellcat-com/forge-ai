"use client";
import { useState } from "react";

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
            onClick={() => setView("workspace")}
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
          <p>
            Your first project
            <br />
            starts with an idea.
          </p>
          <div className="empty-lines">
            <i />
            <i />
            <i />
          </div>
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
              {view === "workspace" ? "New project" : "Providers"}
            </strong>
          </span>
          <span className="topbar-status">
            <span className="status-dot" /> Local first{" "}
            <span className="version">v0.2</span>
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          {view === "workspace" ? (
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
              <section className="composer" aria-label="New project prompt">
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
                  <button
                    className="provider-pill"
                    onClick={() => setView("providers")}
                  >
                    <span className="status-dot amber" /> Configure a provider{" "}
                    <span>⌄</span>
                  </button>
                  <button
                    className="build-button"
                    disabled
                    title="Generation becomes available after provider and runtime setup"
                  >
                    Build project <span>↗</span>
                  </button>
                </div>
              </section>
              <p className="availability">
                <span>◌</span> Foundation is ready. Provider connection and
                isolated generation are next.
              </p>
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
                Provider connections are the next milestone. Credentials will
                stay on the server.
              </p>
              <div className="provider-cards">
                {["Google Gemini", "Local Ollama"].map((name, i) => (
                  <article key={name} className="provider-card">
                    <span className="starter-icon">{i ? "◎" : "✳"}</span>
                    <h2>{name}</h2>
                    <p>
                      {i
                        ? "Use models already installed on your Mac."
                        : "Connect your own free-tier developer API key."}
                    </p>
                    <span className="provider-badge">Not connected</span>
                  </article>
                ))}
              </div>
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
