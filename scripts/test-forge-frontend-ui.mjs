/* global document, innerWidth */
import { chromium } from '/Users/biswaskhatiwada/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({headless:true});const reports=[]
const storage=JSON.parse(await readFile('output/respawn/forge-storage.json','utf8'))
const context=await browser.newContext({storageState:storage});const page=await context.newPage()
const workspace=JSON.parse(storage.origins[0].localStorage.find(x=>x.name.includes('workspace')).value)
const id=workspace.projects?.[0]?.id||workspace.data?.projects?.[0]?.id
for(const width of [390,768,1440]) {
 await page.setViewportSize({width,height:900})
 for(const theme of ['light','dark']) {
  await page.goto('http://127.0.0.1:5173/#/project/'+id)
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'})
  await page.getByRole('button',{name:'Generate website',exact:false}).waitFor()
  await page.screenshot({path:`output/respawn/qa/forge-${theme}-${width}.png`,fullPage:true})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);reports.push({width,theme,overflow})
 }
}
await page.keyboard.press('Tab');await page.screenshot({path:'output/respawn/qa/forge-focus.png'})
await page.setViewportSize({width:720,height:450});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
await writeFile('output/respawn/qa/forge-report.json',JSON.stringify(reports,null,2));await browser.close();console.log('Forge UI viewport checks passed')
