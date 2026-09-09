import './styles.css'
import { canGenerate, createProjectDraft, templates, type Template } from './project.ts'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) throw new Error('App root was not found')

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="Forge AI home">
        <img src="/brand/mark.svg" alt="" />
        <span>Forge <b>AI</b></span>
      </a>
      <nav aria-label="Workspace">
        <a class="active" href="#workspace"><span>⌁</span> Workspace</a>
        <a href="#projects"><span>◇</span> Projects <small>0</small></a>
        <a href="#providers"><span>◎</span> Providers</a>
      </nav>
      <div class="alpha-note">
        <span>PRE-ALPHA</span>
        <p>The interface shell is live. Generation and model adapters are not implemented yet.</p>
      </div>
      <a class="docs-link" href="https://github.com/" rel="noreferrer">Documentation ↗</a>
    </aside>

    <main id="workspace">
      <header>
        <div>
          <p class="eyebrow">NEW PROJECT</p>
          <h1>Shape the idea.<br /><em>Forge the system.</em></h1>
          <p class="lede">Describe the product you want to build. Forge will turn it into a reviewable plan before any code is written.</p>
        </div>
        <div class="status"><i></i> Local workspace</div>
      </header>

      <section class="composer" aria-labelledby="composer-heading">
        <div class="section-title">
          <span>01</span>
          <div><h2 id="composer-heading">Project brief</h2><p>Start with the outcome, users, and constraints.</p></div>
        </div>
        <label>Project name<input id="name" value="customer-portal" /></label>
        <label>What should Forge build?<textarea id="prompt" rows="6">Build a customer support portal with team inboxes, searchable conversations, role-based access, and an audit log.</textarea></label>
        <div class="template-row">
          <label>Starting stack<select id="template">${templates.map((template) => `<option>${template}</option>`).join('')}</select></label>
          <div class="provider-state"><span>AI provider</span><strong><i></i> Not configured</strong></div>
        </div>
        <div class="actions">
          <p><span>⌘</span> Enter to generate</p>
          <button id="generate" disabled>Generate project <span>→</span></button>
        </div>
      </section>

      <section class="process" aria-label="Forge workflow">
        <article><span>02</span><h3>Plan</h3><p>Review architecture, scope, and file changes.</p></article>
        <b>→</b>
        <article><span>03</span><h3>Build</h3><p>Generate inside an isolated workspace.</p></article>
        <b>→</b>
        <article><span>04</span><h3>Verify</h3><p>Inspect diffs and run project checks.</p></article>
      </section>
    </main>
  </div>
`

const nameInput = document.querySelector<HTMLInputElement>('#name')
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt')
const templateInput = document.querySelector<HTMLSelectElement>('#template')
const generateButton = document.querySelector<HTMLButtonElement>('#generate')

function updateGenerateState(): void {
  if (!nameInput || !promptInput || !templateInput || !generateButton) return
  const draft = createProjectDraft({
    name: nameInput.value,
    prompt: promptInput.value,
    template: templateInput.value as Template,
  })
  generateButton.disabled = !canGenerate(draft, false)
}

nameInput?.addEventListener('input', updateGenerateState)
promptInput?.addEventListener('input', updateGenerateState)
templateInput?.addEventListener('change', updateGenerateState)
