import {test,expect} from '@playwright/test';
test.skip(process.env.FORGE_UNIFIED_FIXTURES!=='1','Requires the explicitly imported local integration fixtures.');
const project='55825c5c-3f3f-45cd-90f3-5ad2630f8baf';
for(const width of [390,768,1440])for(const theme of ['light','dark'])test(`workbench ${theme} at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme as 'light'|'dark',reducedMotion:'reduce'});
 await page.goto(`/app/projects/${project}`);await expect(page.getByRole('heading',{name:'Build conversation Saved'})).toBeVisible();
 if(width>900)await expect(page.getByRole('navigation',{name:'Project view'})).not.toBeVisible();
 if(width<=900){await expect(page.getByRole('navigation',{name:'Project view'})).toBeVisible();await page.getByRole('button',{name:'Preview',exact:true}).first().click();}
 await expect(page.getByRole('region',{name:'Generated application'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`docs/evidence/unified/workbench-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
 if(width<=900){await page.getByRole('button',{name:'Chat',exact:true}).click();await expect(page.getByLabel('Refine your app')).toBeVisible();}
});
test('imported engine projects retain their IDs and full revision history',async({request})=>{
 for(const [id,count]of [['3d608a46-acf5-4e53-b630-aa31f021169e',9],['0ca99c59-af71-41c2-bfd4-38a8ec8b45d8',3]] as const){const r=await request.get(`/api/projects/${id}`);expect(r.ok()).toBe(true);const d=await r.json();expect(d.project.id).toBe(id);expect(d.history).toHaveLength(count);expect(Object.keys(d.files).length).toBeGreaterThan(1);}
});
test('private code buffers survive refresh without overwriting server source',async({page,request})=>{
 const detail=await request.get(`/api/projects/${project}`).then(r=>r.json());
 await page.goto(`/app/projects/${project}`);
 await page.evaluate(({project,detail})=>{localStorage.setItem(`forge.editor.${project}`,JSON.stringify({baseRevision:detail.project.activeRevision,files:{...detail.files,'app/page.tsx':'// unsaved browser recovery check\n'+detail.files['app/page.tsx']}}));},{project,detail});
 await page.reload();await page.getByRole('button',{name:'Code',exact:true}).click();
 await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible();
 const unchanged=await request.get(`/api/projects/${project}`).then(r=>r.json());expect(unchanged.files).toEqual(detail.files);
 await page.evaluate(project=>localStorage.removeItem(`forge.editor.${project}`),project);
});
