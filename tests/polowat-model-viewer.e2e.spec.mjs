import {test,expect} from '@playwright/test';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
const runtime=JSON.parse(readFileSync(new URL('../data/generated/polowat-runtime.json',import.meta.url),'utf8'));
const front=id=>{const d=runtime.devices.find(d=>d.id===id);return [d.position[0],d.position[1],d.position[2]+d.size[2]/2];};

for (const software of [false,true]) {
 test(`Polowat whole-system viewport supports inspection and captured zoom (${software?'software':'WebGL'})`,async({page})=>{
  if(software)await page.addInitScript(()=>{
   const getContext=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){return type.startsWith('webgl')?null:getContext.call(this,type,...args);};
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/polowat/model');
  const canvas=page.locator('.polowat-model canvas');
  await expect(page.locator('.polowat-model .unified-model')).toHaveAttribute('data-data-conductor-color','#2563eb');
  await expect(page.locator('.polowat-model .unified-model')).toHaveAttribute('data-centered-gland-count','9');
  await expect(page.locator('.polowat-model .unified-model')).toHaveAttribute('data-contiguous-din-rows','1');
  await expect(page.locator('.polowat-model .unified-model')).toHaveAttribute('data-wire-terminal-tangent-errors','0');
  await expect(canvas).toHaveAttribute('data-renderer',software?'software':'webgl');
  await expect(page.getByRole('button',{name:/Detailed assembly|Whole system|Oblique|DIN terminals/})).toHaveCount(0);
  await expect(page.locator('.inspector')).toHaveCount(0);
  const rect=await canvas.boundingBox();
  expect(rect.height).toBeGreaterThan(800);
  expect(rect.y+rect.height).toBeLessThanOrEqual(1001);
  const data=await canvas.evaluate(element=>({...element.dataset}));
  const camera=new THREE.PerspectiveCamera(43,rect.width/rect.height,.01,35);
  camera.position.fromArray(data.cameraPosition.split(',').map(Number));camera.quaternion.fromArray(data.cameraQuaternion.split(',').map(Number));camera.updateMatrixWorld();
  const projected=new THREE.Vector3(...front('batteryA')).project(camera);
  await page.mouse.click(rect.x+(projected.x+1)*rect.width/2,rect.y+(1-projected.y)*rect.height/2);
  await expect(page.getByRole('complementary',{name:'Model item details'})).toBeVisible();
  await expect(page.locator('.inspector')).toContainText('Battery A');
  await page.keyboard.press('Escape');await expect(page.locator('.inspector')).toHaveCount(0);
  const monitor=new THREE.Vector3(...front('batteryMonitor')).project(camera);
  await page.mouse.click(rect.x+(monitor.x+1)*rect.width/2,rect.y+(1-monitor.y)*rect.height/2);
  await expect(page.locator('.inspector')).toContainText('BMV-700 display');
  await expect(page.locator('.inspector')).toContainText('Purchased');
  await page.keyboard.press('Escape');
  const before=await canvas.getAttribute('data-camera-position');
  await page.mouse.move(rect.width*.52,rect.y+rect.height*.49);await page.mouse.wheel(0,-300);
  await expect(canvas).not.toHaveAttribute('data-camera-position',before);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBe(await page.evaluate(()=>innerHeight));
  await page.setViewportSize({width:390,height:650});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight)).toBe(650);
  await page.reload();await expect(canvas).toBeVisible();await expect(page).toHaveURL(/\/polowat\/model$/);
  await page.getByRole('link',{name:'System',exact:true}).click();
  await expect(page.locator('body')).toHaveCSS('overflow','visible');
  expect(errors).toEqual([]);
 });
}
