/* global document, innerWidth */
import { chromium } from '/Users/biswaskhatiwada/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const out='output/respawn/'
await mkdir(out+'qa',{recursive:true}); await mkdir(out+'interaction-recording',{recursive:true})
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:out+'interaction-recording',size:{width:1440,height:900}}})
const page=await context.newPage();const errors=[];const reports=[];const marks=[];const start=Date.now()
page.on('pageerror',e=>errors.push(e.message))
const hold=ms=>page.waitForTimeout(process.env.FORGE_FAST_QA ? 80 : ms)
const mark=async name=>{marks.push({name,seconds:(Date.now()-start)/1000});await writeFile(out+'interaction-timeline.json',JSON.stringify(marks,null,2));console.log(name)}
try {
await page.goto('http://127.0.0.1:4187');await mark('hero');await hold(5000)
await page.getByRole('button',{name:'Demo login',exact:true}).click();await hold(1800)
await page.getByLabel('Display name',{exact:true}).pressSequentially('PlayerOne',{delay:140});await hold(1200)
await page.getByRole('button',{name:'Enter demo workspace'}).click();assert.match(await page.locator('#loginBtn').innerText(),/PlayerOne/);await hold(1600);await mark('login-complete')
await page.getByRole('button',{name:'Explore the drop'}).click();await hold(3500);await page.screenshot({path:out+'qa/storefront-dark-1440.png'});await mark('browse')
await page.getByRole('button',{name:'Keyboards',exact:true}).click();assert.equal(await page.locator('.product-card').count(),2);await hold(2500)
await page.getByRole('button',{name:'Audio',exact:true}).click();assert.equal(await page.locator('.product-card').count(),2);await hold(2000)
await page.getByRole('button',{name:'All gear',exact:true}).click();await page.getByLabel('Sort products').selectOption('low');await hold(2200);await mark('sorted')
await page.getByLabel('Search gear').pressSequentially('Phantom',{delay:160});assert.equal(await page.locator('.product-card').count(),2);await hold(2400)
await page.getByLabel('Search gear').fill('NoSuchGear');assert.match(await page.locator('#productGrid').innerText(),/No/i);await hold(1500)
await page.getByRole('button',{name:'Reset filters'}).click();await hold(1800);await mark('search-complete')
await page.getByRole('button',{name:'Save Phantom Wireless',exact:true}).click();assert.equal(await page.locator('#savedCount').innerText(),'1');await hold(1800)
await page.getByRole('button',{name:'Saved items',exact:true}).click();assert.equal(await page.locator('.product-card').count(),1);await hold(2800);await mark('wishlist')
await page.getByRole('button',{name:'All gear',exact:true}).click();await page.getByLabel('Sort products').selectOption('featured');await hold(1600)
await page.locator('.product-card').filter({hasText:'Phantom Wireless'}).getByRole('button',{name:'Add to cart'}).click();await hold(1400)
await page.locator('.product-card').filter({hasText:'Nova 75 Mechanical'}).getByRole('button',{name:'Add to cart'}).click();await hold(1400)
await page.getByRole('button',{name:'Cart',exact:true}).click();await hold(2400);assert.match(await page.locator('.cart-total').innerText(),/218/);await mark('cart')
await page.getByRole('button',{name:'Increase Phantom Wireless',exact:true}).click();assert.match(await page.locator('.cart-total').innerText(),/307/);await hold(2400)
await page.getByRole('button',{name:'Decrease Phantom Wireless',exact:true}).click();assert.match(await page.locator('.cart-total').innerText(),/218/);await hold(1600)
await page.getByRole('button',{name:'Remove Nova 75 Mechanical',exact:true}).click();assert.match(await page.locator('.cart-total').innerText(),/89/);await hold(2200);await mark('quantities')
await page.getByRole('button',{name:'Checkout (demo)',exact:true}).click();await hold(2500)
assert.equal(await page.locator('#checkoutNameInput').inputValue(),'PlayerOne')
await page.getByLabel('I understand this is a demo order').check();await hold(1800)
await page.getByRole('button',{name:'Place demo order',exact:true}).click();assert.match(await page.locator('#confirmationMessage').innerText(),/No payment taken/);assert.equal(await page.locator('#cartCount').innerText(),'0');await hold(4500);await page.screenshot({path:out+'qa/demo-order.png'});await mark('checkout-complete')
await page.getByRole('button',{name:'Continue shopping',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);await hold(1800)
await page.getByRole('button',{name:'Cart',exact:true}).click();assert.match(await page.locator('#cartOverlay').innerText(),/empty/);await hold(1500);await page.keyboard.press('Escape');await hold(700)
await page.getByRole('button',{name:'Sign out PlayerOne',exact:true}).click();assert.equal(await page.locator('#loginBtn').innerText(),'Demo login');await mark('signed-out')
await page.getByRole('button',{name:'Toggle theme',exact:true}).click();await hold(2800);await page.screenshot({path:out+'qa/storefront-light-1440.png'});await mark('light-theme')
await page.getByRole('link',{name:'Collections',exact:true}).click();await hold(3300);await mark('collection')
await page.getByRole('button',{name:'Shop keyboards'}).click();await hold(2700);assert.equal(await page.locator('.product-card').count(),2)
await page.getByRole('button',{name:'All gear',exact:true}).click();await page.getByRole('button',{name:'Toggle theme',exact:true}).click();await page.getByRole('link',{name:'Discover',exact:true}).click();await hold(3500);await mark('end')
reports.push({flow:'search, filters, sorting, wishlist, login/signout, quantity/remove, checkout, empty cart, themes, collection',passed:true})
for (const width of [390,768,1440]) {
 await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:4187');
 for (const theme of ['dark','light']) {
   if(theme==='light') await page.locator('#themeToggle').click()
   await hold(350)
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
   const missingImages=await page.locator('img').evaluateAll(images=>images.filter(i=>!i.complete||i.naturalWidth===0).length)
   await page.screenshot({path:out+`qa/market-${theme}-${width}.png`,fullPage:true})
   reports.push({width,theme,overflow,missingImages});assert.equal(overflow,false);assert.equal(missingImages,0)
 }
}
await page.setViewportSize({width:1440,height:900});await page.goto('http://127.0.0.1:4187');await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#loginBtn').click();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#loginOverlay').evaluate(d=>d.contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#loginBtn').evaluate(e=>e===document.activeElement),true)
await page.keyboard.press('Tab');await page.screenshot({path:out+'qa/keyboard-focus.png'})
await page.setViewportSize({width:720,height:450});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'qa/zoom-200.png'})
reports.push({keyboardModalFocus:true,escapeReturnFocus:true,reducedMotion:true,zoom200:true,consoleErrors:errors});assert.equal(errors.length,0)
} catch(error) { console.error(error); throw error } finally {await writeFile(out+'qa/report.json',JSON.stringify(reports,null,2));await context.close();await writeFile(out+'interaction-video-path.txt',await page.video().path());await browser.close()}
console.log('Storefront browser checks passed')
