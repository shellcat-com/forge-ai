import { downloadFile } from './export.ts'

const assetNames = ['hero', 'controller', 'keyboard', 'headset', 'mouse'] as const
export function isolatedWebsite(html: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: http://127.0.0.1:5173/marketplace/ http://localhost:5173/marketplace/; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
  return html.replace(/<!doctype html>/i, `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">`)
}
export async function downloadWebsite(html: string): Promise<void> {
  let portable = html
  for (const name of assetNames) {
    const path = `/marketplace/${name}.webp`
    if (!portable.includes(path)) continue
    const response = await fetch(path)
    if (!response.ok) throw new Error('Artwork unavailable')
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      void response.blob().then(blob => reader.readAsDataURL(blob)).catch(reject)
    })
    portable = portable.replaceAll(`http://127.0.0.1:5173${path}`, data).replaceAll(`http://localhost:5173${path}`, data).replaceAll(path, data)
  }
  downloadFile('forge-website.html', portable, 'text/html')
}
