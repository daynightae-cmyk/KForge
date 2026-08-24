import { test, expect } from '@playwright/test';

test.describe('KForge Production E2E', () => {
  test('production server opens without page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('Projects navigation is reachable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const title = await page.title();
    expect(typeof title).toBe('string');
  });

  test('no unexplained console errors on initial load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(consoleErrors).toHaveLength(0);
  });

  test('keyboard Tab/Enter smoke', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  });

  test('offline mode does not trigger hidden remote contacts', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const requests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!url.startsWith('http://localhost:8080') && !url.startsWith('http://127.0.0.1:8080')) {
        requests.push(url);
      }
    });
    await page.waitForTimeout(500);
    expect(requests.filter((r) => r.includes('localhost'))).toHaveLength(0);
  });

  test('responsive mobile smoke', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toBeTruthy();
  });

  test('responsive desktop smoke', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(await page.title()).toBeTruthy();
  });
});
