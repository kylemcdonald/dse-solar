import {test,expect} from '@playwright/test';

test('Polowat private exports live on Costs and are absent from BOM',async({page})=>{
 await page.goto('/polowat/bom');
 await expect(page.getByRole('complementary',{name:'Private receipt tracking'})).toBeVisible();
 await expect(page.locator('.receipt-inbox a')).toHaveCount(0);
 await page.getByRole('link',{name:'Costs',exact:true}).click();
 for(const name of ['Download parts CSV','Download receipts + ledger ZIP','Download expense report PDF'])await expect(page.getByRole('link',{name,exact:true})).toBeVisible();
 for(const format of ['csv','zip','pdf']){
  const response=await page.request.get(`/api/receipts/inbox?project=polowat&download=${format}`);
  expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store');
 }
});
test('public-mode response hides every export for both projects',async({page})=>{
 await page.route('**/api/receipts/status',route=>route.fulfill({status:404,body:'Not found'}));
 for(const project of ['polowat','fiji']){
  await page.goto(`/${project}/costs`);
  await expect(page.locator('.cost-view')).toBeVisible();
  await expect(page.locator('.grant-report-export,.receipt-archive-download')).toHaveCount(0);
  await page.goto(`/${project}/bom`);
  await expect(page.locator('.receipt-inbox')).toHaveCount(0);
 }
});
