/* global console */
import {chromium} from '/Users/biswaskhatiwada/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import{writeFile}from'node:fs/promises'
const root='/Volumes/ForgeRecordingTemp/process'
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:root+'/tour',size:{width:1600,height:900}}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const start=Date.now()
const hold=ms=>page.waitForTimeout(ms)
try{
 await page.goto('file://'+root+'/index.html');await hold(2300)
 await page.getByText(/^Phantom Wireless/).first().scrollIntoViewIfNeeded();await hold(1200)
 const keyboard=page.getByRole('button',{name:/^Keyboards$/i});if(await keyboard.count()){await keyboard.click();await hold(1100)}
 const all=page.getByRole('button',{name:/^All( gear| products)?$/i});if(await all.count())await all.first().click()
 const add=page.getByRole('button',{name:/Add to cart/i});if(await add.count()){await add.first().click();await hold(700)}
 const cart=page.getByRole('button',{name:/^(Open )?(Shopping )?Cart( \d+| \(\d+\))?$/i});if(await cart.count()){await cart.first().click();await hold(1700);await page.keyboard.press('Escape')}
 const theme=page.getByRole('button',{name:/theme|light mode|appearance/i});if(await theme.count()){await theme.first().click();await hold(900)}
 await page.getByText(/Less noise|Your next level|Collections/i).last().scrollIntoViewIfNeeded().catch(()=>{});await hold(1000)
 await page.keyboard.press('ControlOrMeta+Home');await hold(1700)
 await page.screenshot({path:root+'/result.png'})
 await writeFile(root+'/tour-timing.json',JSON.stringify({seconds:(Date.now()-start)/1000,errors},null,2));console.log('Fresh generated result toured')
}finally{await context.close();await writeFile(root+'/tour-video-path.txt',await page.video().path());await browser.close()}
