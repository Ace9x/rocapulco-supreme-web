import { test, expect } from '@playwright/test';
test.use({ geolocation: { latitude: 40.7128, longitude: -73.8314 }, permissions: ['geolocation'] });
test('quote routes via Valhalla, never OSRM', async ({ page }) => { const hosts = []; page.on('request', r => hosts.push(new URL(r.url()).host));
  await page.addInitScript(() => localStorage.setItem('qc_onboarded', 'true'));
  await page.goto('http://localhost:8099/?transport=local&nosplash=1&to=JFK#/rider'); await expect(page.locator('#fare')).toContainText('$75.00', { timeout: 30000 });
  await expect(page.locator('#est')).not.toContainText('approx', { timeout: 5000 });
  expect(hosts).not.toContain('router.project-osrm.org'); expect(hosts).toContain('valhalla1.openstreetmap.de'); });
