export const sampleBrief =
  'Build a calm customer support portal with a shared inbox, searchable conversations, team assignments, and a clear activity history.'
export const demoSteps = [
  'Brief received',
  'Plan prepared',
  'Sample assembled',
  'Ready for review',
] as const
export const sampleFiles = {
  'app/page.tsx': `// Sample fixture — not generated output\nexport default function Portal() {\n  return (\n    <main>\n      <h1>A little clarity for your customers.</h1>\n      <p>One shared space for every conversation.</p>\n      <button>Open your inbox</button>\n    </main>\n  )\n}\n`,
  'styles/tokens.css': `/* Sample design tokens */\n:root {\n  --canvas: #fdfcfc;\n  --ink: #201d1d;\n  --space: 24px;\n}\n`,
  'README.md':
    '# Customer portal sample\n\nThis is a deterministic walkthrough fixture.\nNo model calls, builds, or checks were executed.\n',
}
