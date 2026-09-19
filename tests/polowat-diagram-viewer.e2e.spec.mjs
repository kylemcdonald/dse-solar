import {test,expect} from '@playwright/test';

test('Polowat uses Fiji schematic navigation, inspection, zoom and enclosure subpatch',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/polowat/diagram');
 const diagram=page.locator('.unified-diagram');
 await expect(diagram).toHaveAttribute('data-diagram-scope','system');
 await expect(diagram).toHaveAttribute('data-layout-source','build-generated-artifact');
 await expect(diagram).toHaveAttribute('data-wire-count','29');
 await expect(diagram).toHaveAttribute('data-node-overlaps','0');
 await page.getByRole('button',{name:'Main junction box',exact:true}).click();
 await expect(diagram).toHaveAttribute('data-junction-id','equipmentEnclosure');
 await expect(diagram).toHaveAttribute('data-visible-device-count','16');
 for(const id of ['positiveBus','negativeBus','loadPositiveBus','loadNegativeBus','batteryBreakerA','batteryBreakerB','batteryShunt','batteryMonitor','monitorFuse']){
  const node=page.locator(`.diagram-device[data-device-id="${id}"]`);
  await expect(node).toBeVisible();await node.click();
  await expect(page.getByRole('complementary',{name:'Model item details'})).toBeVisible();
  await page.keyboard.press('Escape');
 }
 const mppt=page.locator('.diagram-device[data-device-id="mppt"]');
 await mppt.click();
 await expect(page.getByRole('complementary',{name:'Model item details'})).toBeVisible();
 await expect(page.locator('.inspector')).toContainText('SmartSolar');
 await page.keyboard.press('Escape');
 await expect(page.locator('.inspector')).toHaveCount(0);
 await expect(diagram).toHaveAttribute('data-diagram-scope','junction');
 await page.getByRole('button',{name:'Back to full-system diagram'}).click();
 await expect(diagram).toHaveAttribute('data-diagram-scope','system');
 const before=await diagram.getAttribute('data-view-scale');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await expect(diagram).not.toHaveAttribute('data-view-scale',before);
 await page.getByRole('button',{name:'Fit diagram'}).click();
 await page.setViewportSize({width:390,height:650});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight)).toBe(650);
 await page.reload();await expect(diagram).toHaveAttribute('data-diagram-scope','system');
 await page.locator('.project-switcher a').filter({hasText:'Fiji'}).click();
 await expect(page.locator('.app-shell')).toHaveAttribute('data-project','dse-fiji');
 await expect(diagram).toHaveAttribute('data-diagram-scope','system');
 expect(errors).toEqual([]);
});
