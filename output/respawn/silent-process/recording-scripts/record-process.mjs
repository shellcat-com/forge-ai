/* global console */
import { chromium } from '/Users/biswaskhatiwada/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
const out='/Volumes/ForgeRecordingTemp/process';await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:out,size:{width:1600,height:900}},colorScheme:'dark',acceptDownloads:true})
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const start=Date.now();const marks=[]
const mark=async name=>{marks.push({name,seconds:(Date.now()-start)/1000});await writeFile(out+'/timeline.json',JSON.stringify(marks,null,2));console.log(name)}
const hold=ms=>page.waitForTimeout(ms)
const brief=`Create Respawn, a beautiful marketplace for gamers who care about their setup. Make it feel like a premium gaming brand: midnight black, lavender, a small coral accent, bold typography, generous spacing, and a cinematic controller hero. Headline: Good games. Great gear.

Build a real interactive standalone frontend. The top navigation should have Discover, Gear, Collections, live search, saved items, a theme toggle, and a cart. Show a responsive product grid with category filters and price sorting. Include a keyboard collection feature below the products.

Products: Phantom Wireless controller ($89), Nova 75 Mechanical keyboard ($129), Eclipse Spatial headset ($109), and Drift Ultralight mouse ($59). Use these original GPT artwork files from the local asset server: http://127.0.0.1:5173/marketplace/hero.webp for the hero, plus controller.webp, keyboard.webp, headset.webp and mouse.webp in that same directory for the product cards.

Make search, category buttons, saved items and cart controls work. Add quantity controls, remove buttons, an accurate subtotal and an empty cart state. Use native modal dialogs with keyboard focus handling. Demo checkout must require confirmation and say no payment taken. Demo login asks for a display name only, with sign out. Do not collect passwords or payment details.

Keep everything responsive at mobile, tablet and desktop widths, with matching light and dark themes and reduced motion support. Use system fonts, inline CSS and JavaScript, no external dependencies, and in-memory state. Return one complete HTML document that can be previewed and downloaded.`
try{
await hold(600);await page.goto('http://127.0.0.1:5173');await hold(3000);await mark('landing')
await page.getByRole('link',{name:'Explore Forge',exact:false}).first().click();await hold(2800);await mark('login')
await page.getByRole('link',{name:'Explore demo workspace'}).click();await hold(2500);await mark('onboarding')
await page.getByRole('button',{name:'Create my first project'}).click();await hold(1500)
await page.getByRole('link',{name:/Projects/}).first().click();await hold(1800);await mark('projects')
await page.getByRole('link',{name:'＋ New project',exact:false}).first().click();await hold(1500)
await page.getByRole('textbox',{name:'Project name',exact:true}).pressSequentially('Respawn — Gaming Marketplace',{delay:100});await hold(500)
await page.getByRole('textbox',{name:'What would you like to build?'}).pressSequentially(brief,{delay:62,timeout:180000});await hold(1600);await mark('brief-typed')
await page.getByLabel('Starting stack').selectOption('React + Express');await hold(1500)
await page.locator('input[value="editorial-product"]').check();await hold(1900)
await page.getByRole('button',{name:'Switch preview theme'}).click();await hold(1500)
await page.locator('input[value="technical-mono"]').check();await hold(1600);await mark('design-selected')
await page.getByRole('button',{name:'Create project',exact:false}).click();await hold(2100);await mark('project-created')
await page.getByRole('link',{name:'Edit brief',exact:true}).click();await hold(1200)
await page.getByRole('textbox',{name:'What would you like to build?'}).press('ControlOrMeta+End');await page.getByRole('textbox',{name:'What would you like to build?'}).pressSequentially('\n\nFinal detail: every product card needs a clear Add to cart button and a save heart. Keep the hero artwork on the right and the headline on the left.',{delay:60});await hold(900)
await page.getByRole('button',{name:'Save changes'}).click();await hold(1200)
await page.getByRole('link',{name:/Projects/}).first().click();await hold(1600)
await page.getByRole('heading',{name:'Respawn — Gaming Marketplace',exact:true}).click();await hold(1400)
await page.locator('#provider-model').selectOption('deepseek-v4-pro');await page.getByRole('button',{name:'Generate website'}).scrollIntoViewIfNeeded();await hold(2300);await mark('generation-start')
const resultPromise=page.waitForResponse(r=>r.url().endsWith('/api/website'),{timeout:250000})
await page.getByRole('button',{name:'Generate website'}).click()
const response=await resultPromise;const result=await response.json();await writeFile(out+'/provider-result.json',JSON.stringify(result,null,2));if(!response.ok())throw Error(result.error);await mark('generation-end')
await page.locator('iframe.generated-website').waitFor();await hold(3800)
await page.getByRole('tab',{name:'Files',exact:true}).click();await hold(1700)
const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download website'}).click();await(await downloaded).saveAs(out+'/index.html');await hold(1200)
await page.getByRole('tab',{name:'Preview',exact:true}).click();await hold(2100);await mark('end')
await writeFile(out+'/brief.txt',brief);await writeFile(out+'/errors.json',JSON.stringify(errors));
}finally{await context.close();await writeFile(out+'/video-path.txt',await page.video().path());await browser.close()}
console.log('Fresh live Forge process recorded')
