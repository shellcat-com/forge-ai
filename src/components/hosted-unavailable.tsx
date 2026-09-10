import React from 'react'

/** Shared by the canonical Next route and the opt-in static fallback publisher.
 * Platform UI, never a generated portfolio or successful engine demonstration. */
export function HostedUnavailable() {
  return (
    <div className="hosted-site">
      <a className="hosted-skip" href="#main">
        Skip to content
      </a>
      <header className="hosted-header">
        <a href="#main" aria-label="Forge home" className="hosted-brand">
          FORGE<span> AI</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#availability">Availability</a>
          <a href="#workflow">Workflow</a>
          <a href="#source">Source</a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="hosted-hero" aria-labelledby="title">
          <p className="hosted-eyebrow">OPEN SOURCE · BRING YOUR OWN KEY</p>
          <h1 id="title">
            A place to shape
            <br />
            your next idea.
          </h1>
          <p className="hosted-intro">
            Forge is a workspace for reviewing plans, source changes and application checks. This
            public website introduces the project while its hosted builder is being connected.
          </p>
          <a className="hosted-action" href="#availability">
            See what is available <span aria-hidden="true">↘</span>
          </a>
        </section>
        <section id="availability" className="hosted-section" aria-labelledby="availability-title">
          <p className="hosted-eyebrow">CURRENT AVAILABILITY</p>
          <h2 id="availability-title">The hosted builder is unavailable.</h2>
          <p>
            Generation, sign-in, private previews and source publishing are not connected on this
            website. You cannot submit a brief or a provider key here.
          </p>
          <p>
            BYOK is part of the intended flow. Using your own key still requires a supported model
            and an explicit spending limit.
          </p>
          <p className="hosted-note">
            No live generated portfolio has been published through this demo. Sample walkthroughs
            and local tests do not establish that the hosted engine works.
          </p>
        </section>
        <section id="workflow" className="hosted-section" aria-labelledby="workflow-title">
          <p className="hosted-eyebrow">THE INTENDED WORKFLOW</p>
          <h2 id="workflow-title">Review each step.</h2>
          <ol className="hosted-steps">
            <li>
              <h3>Describe and review</h3>
              <p>
                Start with a brief. Review the plan, then the actual source changes and proposed
                commands.
              </p>
            </li>
            <li>
              <h3>Approve and check</h3>
              <p>
                Approve the exact source for isolated checks. Inspect results and any proposed
                repairs before proceeding.
              </p>
            </li>
            <li>
              <h3>Try and publish</h3>
              <p>
                Use the private app, review its history and export its source. Public publishing
                requires a separate verified artifact.
              </p>
            </li>
          </ol>
        </section>
        <section id="source" className="hosted-section" aria-labelledby="source-title">
          <p className="hosted-eyebrow">FOLLOW THE WORK</p>
          <h2 id="source-title">Source, evidence and limitations.</h2>
          <p>
            The repository documents the local workflow, implementation progress and the remaining
            live integration requirements.
          </p>
          <a className="hosted-action" href="https://github.com/shellcat-com/forge-ai">
            View the repository <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>
      <footer className="hosted-footer">
        <p>Forge AI · Public website only</p>
        <a href="#main">Back to top ↑</a>
      </footer>
    </div>
  )
}
