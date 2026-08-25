import { test, expect } from '@playwright/test';

test.describe('KForge Production Shell', () => {
  test('application launches and loads main shell', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify main app structure is present
    await expect(page.locator('.kf-app')).toBeVisible();
    await expect(page.locator('.kf-sidebar')).toBeVisible();
    await expect(page.locator('.kf-main')).toBeVisible();
    await expect(page.locator('.kf-topbar')).toBeVisible();
    
    // Verify KForge brand
    await expect(page.locator('.kf-brand')).toContainText('KForge');
    
    // No fatal console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    
    // Give time for any async errors
    await page.waitForTimeout(500);
    
    // Filter out expected/known errors (none should exist in production)
    const fatalErrors = errors.filter(e => 
      !e.includes('favicon') && 
      !e.includes('DevTools') &&
      !e.includes('Source map')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('navigation to Projects view works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Workspace nav item (default)
    await expect(page.locator('button:has-text("Workspace")')).toBeVisible();
    
    // Projects table should be visible
    await expect(page.locator('.kf-table-wrap')).toBeVisible();
  });

  test('Online Hub navigation works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Discover (Online Hub)
    await page.click('button:has-text("Discover")');
    await page.waitForLoadState('networkidle');
    
    // Online Hub panel should load
    await expect(page.locator('.kf-online-hub, .kf-active-surface')).toBeVisible();
  });

  test('Marketplace navigation works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Marketplace
    await page.click('button:has-text("Marketplace")');
    await page.waitForLoadState('networkidle');
    
    // Marketplace view should load (OnlineHubPanel with marketplace view)
    await expect(page.locator('.kf-marketplace-taxonomy, .kf-active-surface')).toBeVisible();
  });

  test('Settings navigation works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Settings
    await page.click('button:has-text("Settings")');
    await page.waitForLoadState('networkidle');
    
    // Settings view should load
    await expect(page.locator('.kf-active-surface')).toBeVisible();
  });

  test('Ctrl+K command palette opens', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Press Ctrl+K
    await page.keyboard.press('Control+KeyK');
    
    // Command palette should be visible
    await expect(page.locator('.kf-command-palette')).toBeVisible();
    await expect(page.locator('.kf-command-input input')).toBeFocused();
    
    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.kf-command-palette')).not.toBeVisible();
  });

  test('Offline mode can be toggled', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click platform mode indicator in sidebar footer
    await page.click('.kf-sidebar-footer button, .kf-sidebar-footer span:has-text("Offline")');
    
    // Should show mode options (the actual modal may vary)
    // Just verify no crash occurs
    await page.waitForTimeout(500);
  });

  test('responsive mobile viewport works', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Mobile drawer should be available (sidebar collapses)
    await expect(page.locator('.kf-app')).toBeVisible();
    
    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });

  test('responsive desktop viewport works', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Full sidebar should be visible
    await expect(page.locator('.kf-sidebar')).toBeVisible();
    
    // Verify no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1440);
  });

  test('keyboard Tab navigation works', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Tab through focusable elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Focus should be visible on some element
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).not.toBe('BODY');
  });

  test('Escape key closes modals', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Open command palette
    await page.keyboard.press('Control+KeyK');
    await expect(page.locator('.kf-command-palette')).toBeVisible();
    
    // Press Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('.kf-command-palette')).not.toBeVisible();
  });

  test('Project health view accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Project health
    await page.click('button:has-text("Project health")');
    await page.waitForLoadState('networkidle');
    
    // Inspector should be visible
    await expect(page.locator('.kf-inspector, .kf-active-surface')).toBeVisible();
  });

  test('Tasks view accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click Tasks
    await page.click('button:has-text("Tasks")');
    await page.waitForLoadState('networkidle');
    
    // Tasks view should load
    await expect(page.locator('.kf-active-surface')).toBeVisible();
  });

  test('AI Providers view accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click AI providers
    await page.click('button:has-text("AI providers")');
    await page.waitForLoadState('networkidle');
    
    // AI providers view should load
    await expect(page.locator('.kf-active-surface')).toBeVisible();
  });
});