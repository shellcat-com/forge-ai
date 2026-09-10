import { test, expect } from '@playwright/test';
test('prompt, mode and custom direction survive navigation and reload without generation',async({page})=>{
 await page.goto('/app');
 await page.getByRole('button',{name:/A calmer daily ritual/}).click();
 await expect(page.getByLabel('Describe your project')).toHaveValue(/Pomodoro/);
 await page.getByRole('button',{name:'Plan',exact:true}).click();
 await page.getByText('Visual direction & model').click();
 await page.getByLabel('Your visual direction').fill('Colorful illustrated interface');
 await expect(page.getByLabel('Starting example')).toHaveValue('');
 await page.getByRole('link',{name:'Connections',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Google Gemini'})).toBeVisible();
 await page.goto('/app');await page.reload();
 await expect(page.getByLabel('Describe your project')).toHaveValue(/Pomodoro/);
 await expect(page.getByRole('button',{name:'Plan',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByText('Visual direction & model').click();
 await expect(page.getByLabel('Your visual direction')).toHaveValue('Colorful illustrated interface');
});
for(const theme of ['light','dark'])for(const width of [375,390,768,1440]){
 test(`${theme} workspace fits ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/app');
  if(width<=900)await page.getByRole('button',{name:'Toggle workspace navigation'}).click();
  await page.getByRole('button',{name:`${theme[0].toUpperCase()+theme.slice(1)} theme`,exact:true}).click();
  if(width<=900)await page.getByRole('button',{name:'Close navigation',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`docs/evidence/unified/home-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
  await page.goto('/app/projects');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`docs/evidence/unified/projects-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
 });
}
test('keyboard skip link reaches workspace',async({page})=>{
 await page.goto('/app');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to workspace'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('main')).toBeFocused();
});
test('legacy links lead to canonical routes',async({page})=>{
 await page.goto('/?project=55825c5c-3f3f-45cd-90f3-5ad2630f8baf');await expect(page).toHaveURL(/\/app\/projects\/55825/);
 await page.goto('/#/designs');await expect(page).toHaveURL(/\/examples$/);
});
