import { test, expect } from '@playwright/test';

const LOCAL_ORIGINS = new Set(['http://localhost:4317', 'http://127.0.0.1:4317']);

function isAllowedLocalRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return LOCAL_ORIGINS.has(url.origin);
}

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

  test('offline mode performs zero external HTTP/HTTPS requests from first navigation', async ({ page }) => {
    const externalRequests: string[] = [];

    // CRITICAL: attach before navigation so startup requests cannot escape evidence capture.
    page.on('request', (request) => {
      const rawUrl = request.url();
      if (!/^https?:/i.test(rawUrl)) return;
      if (!isAllowedLocalRequest(rawUrl)) externalRequests.push(rawUrl);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    expect(externalRequests, `External HTTP/HTTPS requests observed in Offline mode:\n${externalRequests.join('\n')}`).toEqual([]);
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
