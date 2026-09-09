import { topbar, footer, imageArt, preview } from '../components/ui.ts'
import { presets } from '../design/presets.ts'
export function miniBuilder(): string {
  return `<div class="demo-window"><div class="window-top"><span class="window-dots">● ● ●</span><span>Forge workspace</span><span>Sample walkthrough</span></div><div class="demo-layout"><aside class="demo-sidebar"><strong>Workspace</strong><span class="demo-current">◇ Customer portal</span><span>◇ Reading room</span><span>◇ Studio website</span><small>LOCAL DEMO</small></aside><div class="demo-chat"><span class="eyebrow">CUSTOMER PORTAL</span><p class="chat-bubble">A calmer place for every customer conversation.</p><p>First, a clear plan.</p><ol><li>Define the shared inbox</li><li>Choose a visual direction</li><li>Review the experience</li></ol><div class="file-chip">▤ &nbsp; Project brief <span>ready</span></div><div class="demo-composer">Describe your next idea… <span>↑</span></div></div><div class="demo-preview"><div class="demo-tabs">Preview <span>Files</span><span>Checks</span><span>↗</span></div><div class="portal-preview"><div class="portal-nav">fieldnotes <span>Workspace ↗</span></div><h3>A little clarity.<br>A lot more connection.</h3><p>One shared space for every conversation.</p><div class="portal-inbox"><span>Inbox <small>03 conversations</small></span><div>◉ &nbsp; Getting started <small>Today</small></div><div>◎ &nbsp; A quick question <small>Today</small></div><div>◎ &nbsp; Team access <small>Yesterday</small></div></div></div></div></div></div>`
}
function figures(): string {
  return `<div class="figures"><figure><div class="figure-lines" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div><figcaption>Fig 1. <strong>One clear brief</strong><p>Start with the problem worth solving.</p></figcaption></figure><figure><div class="figure-dots" aria-hidden="true">${'<i></i>'.repeat(96)}</div><figcaption>Fig 2. <strong>Your own direction</strong><p>Examples are just the beginning.</p></figcaption></figure><figure><div class="figure-bars" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i style="height:${25 + ((i * 17) % 65)}%"></i>`).join('')}</div><figcaption>Fig 3. <strong>A considered review</strong><p>See the details. Decide what’s next.</p></figcaption></figure></div>`
}
export function presetCards(): string {
  return presets
    .map(
      (p, i) =>
        `<article class="preset-card"><a href="#/presets/${p.id}" aria-label="Explore ${p.name}">${preview(p.id, 'light', undefined, true)}</a><div class="preset-caption"><span>0${i + 1}</span><div><h3><a href="#/presets/${p.id}">${p.name} ↗</a></h3><p>${p.description}</p></div></div></article>`
    )
    .join('')
}
export function landing(): string {
  return `<div class="marketing">${topbar()}<main><section class="hero"><p class="announcement"><span>Pre-alpha</span> A workspace for your next idea. <a href="#/docs">Meet Forge ↗</a></p><h1>Good software starts<br>with a clear idea.</h1><p class="hero-lede">Describe what you want to build. Shape the design.<br class="desktop-only"> Explore a more considered way to make software.</p><div class="hero-actions"><a class="button primary" href="#/login">Start building <span>↗</span></a><a class="text-link" href="#/sample">Take a look inside <span>→</span></a></div><p class="microcopy">A real local engine. Hosted beta in preparation.</p></section><section class="showcase" aria-label="Sample Forge workspace">${imageArt('landscape', '', true)}${miniBuilder()}<div class="showcase-caption"><span>01 / THE WORKSPACE</span><span>Illustrative demo · No AI generation</span></div></section><div class="section-heading intro-line"><p>A little more intention.<br>A lot more possibility.</p><p>From the first sentence to the final detail,<br>give your next project a clear direction.</p></div><section class="feature-row"><div class="feature-copy"><span class="eyebrow">01 / SHAPE THE IDEA</span><h2>Start with what matters.</h2><p>The people. The problem. The things it needs to do. Bring your brief into one focused workspace.</p><a class="text-link" href="#/new">Write your first brief →</a></div><div class="brief-illustration"><div class="paper"><span class="eyebrow">PROJECT BRIEF</span><h3>A home for better conversations.</h3><p>A shared inbox for a small team that cares about the details.</p><div class="paper-rule"></div><span class="paper-label">WHO IT’S FOR</span><p>People building lasting customer relationships.</p><div class="paper-rule"></div><span class="paper-label">WHAT MATTERS</span><div class="tags"><span>Clarity</span><span>Care</span><span>Connection</span></div></div></div></section><section class="feature-row reverse"><div class="feature-copy"><span class="eyebrow">02 / FIND THE FEELING</span><h2>Give the idea a point of view.</h2><p>Start with your own direction, bring a reference, or explore five optional examples. The possibilities are yours.</p><a class="text-link" href="#/presets">Find your direction →</a></div><div class="feature-preview">${preview('editorial-product', 'light', undefined, true)}<span class="feature-label">EDITORIAL PRODUCT / LIGHT</span></div></section><section class="feature-row"><div class="feature-copy"><span class="eyebrow">03 / CONSIDER THE DETAILS</span><h2>Make room for a second look.</h2><p>Explore a sample plan, preview, file tree, and review checklist. A walkthrough of the workspace we’re building toward.</p><a class="text-link" href="#/sample">Explore the walkthrough →</a></div><div class="review-illustration"><span class="eyebrow">SAMPLE REVIEW</span><h3>The small things are the big things.</h3><div>✓ <span>One clear visual direction</span><small>Sample</small></div><div>✓ <span>Light and dark, considered</span><small>Sample</small></div><div>✓ <span>A place for every detail</span><small>Sample</small></div><p>Illustrative checklist. No checks executed.</p></div></section><section class="preset-section"><div class="section-heading"><div><span class="eyebrow">OPTIONAL STARTING POINTS</span><h2>Five ways to make it yours.</h2></div><a class="text-link" href="#/presets">Explore all examples ↗</a></div><div class="preset-grid">${presetCards()}</div></section><section class="process-section"><h2>From an idea to a direction.</h2>${figures()}</section><section class="faq-section"><h2>A few things to know.</h2><div>${[
    [
      'What can I do in Forge today?',
      'Describe an idea, generate with a configured model, inspect the running preview, edit files, and revisit revisions. Five optional examples and a labeled sample remain available.',
    ],
    [
      'Does Forge generate working applications?',
      'Yes, with a configured provider and local worker. Forge builds generated code in isolated Docker workspaces. Hosted capabilities are enabled only after setup and verification.',
    ],
    [
      'Where do my projects live?',
      'New projects live in your configured Forge database. Earlier browser-only briefs can be imported from a JSON backup.',
    ],
    [
      'Can I use the design systems elsewhere?',
      'Yes. Each downloadable package includes theme tokens, scoped CSS, section recipes, design guidance and original artwork references.',
    ],
    [
      'Do I need an account?',
      'Local mode needs no account. Hosted access uses configured authentication and beta invitations.',
    ],
  ]
    .map(([q, a]) => `<details><summary>${q}<span>+</span></summary><p>${a}</p></details>`)
    .join(
      ''
    )}</div></section><section class="closing"><p class="eyebrow">YOUR NEXT IDEA IS A GOOD PLACE TO START.</p><h2>Let’s give it shape.</h2><a class="button primary" href="#/login">Start building ↗</a></section></main>${footer()}</div>`
}
