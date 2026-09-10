import {test,expect} from '@playwright/test';
const url=process.env.FORGE_POMODORO_PREVIEW;
test.skip(!url,'Set FORGE_POMODORO_PREVIEW to a generated benchmark; this is a release acceptance gate.');
test.beforeEach(async({page})=>{await page.clock.install();await page.goto(url!);await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible();});
test('Start, Pause, Resume and Reset behave under a controlled clock',async({page})=>{
 await page.getByRole('button',{name:'Start',exact:true}).click();await page.clock.runFor(2000);await expect(page.getByText('24:58',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.clock.runFor(3000);await expect(page.getByText('24:58',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Start|Resume/,exact:true}).click();await page.clock.runFor(1000);await expect(page.getByText('24:57',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(page.getByText('25:00',{exact:true})).toBeVisible();
 await page.screenshot({path:'docs/evidence/unified/pomodoro-controls.png',fullPage:true});
});
test('custom durations persist through reload',async({page})=>{
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Focus (minutes):').fill('1');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('01:00',{exact:true})).toBeVisible();await page.reload();
 await expect(page.getByText('01:00',{exact:true})).toBeVisible();
});
test('focus completion counts a session and starts the break automatically',async({page})=>{
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Focus (minutes):').fill('1');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('button',{name:'Start',exact:true}).click();await page.clock.runFor(60000);await expect(page.getByRole('heading',{name:'Break',exact:true})).toBeVisible();await expect(page.getByText('Sessions completed: 1')).toBeVisible();
 await page.screenshot({path:'docs/evidence/unified/pomodoro-break-state.png',fullPage:true});
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
});
