import { test, expect } from 'vitest';
import { chromium } from '@playwright/test';

// Base URL for KForge application (local development)
const KFORGE_URL = 'http://localhost:8081';

test('application launches successfully', async () => {
  // Launch KForge application
  const page = await chromium.launch({ url: KFORGE_URL });
  
  // Wait for main content to load
  await page.waitForSelector('#app');
  
  // Verify main application elements are present
  const appTitle = await page.title();
  expect(appTitle).toBeContaining('KForge');
  
  // Verify navigation links are present
  const linkCount = await page.count('a');
  expect(linkCount).greaterThan(5);
  
  await page.close();
});

test('projects can be listed and searched', async () => {
  const page = await chromium.launch({ url: KFORGE_URL });
  
  // Navigate to projects page
  await page.goto(`${KFORGE_URL}/projects`);
  
  // Verify projects list is populated
  const projectCount = await page.evaluate(() => (
    document.querySelectorAll('#projects-list .project-item').length
  ));
  expect(projectCount).greaterThan(0);
  
  // Test search functionality
  await page.fill('#search-input', 'KForge');
  await page.click('#search-button');
  
  // Verify search results appear
  const resultCount = await page.evaluate(() => (
    document.querySelectorAll('#search-results .result').length
  ));
  expect(resultCount).greaterThan(0);
  
  await page.close();
});

test('online hub discovers projects', async () => {
  const page = await chromium.launch({ url: KFORGE_URL });
  
  // Go to online hub
  await page.goto(`${KFORGE_URL}/online-hub`);
  
  // Verify online hub is accessible
  const hubPresent = await page.isVisible('#online-hub');
  expect(hubPresent).toBeTrue();
  
  // Verify project listings
  const projectItems = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll('#online-hub .project-item')
        .filter(item => item.textContent.trim())
    ).length;
  });
  expect(projectItems).greaterThan(0);
  
  await page.close();
});

test('marketplace package installation', async () => {
  const page = await chromium.launch({ url: KFORGE_URL });
  
  // Navigate to marketplace
  await page.goto(`${KFORGE_URL}/marketplace`);
  
  // Find a sample package
  const packageName = await page.locator('.package-name').first().textContent();
  expect(packageName).toBeDefined();
  
  // Click install button
  await page.click('[data-action="install"]');
  
  // Verify installation status
  const status = await page.locator('#install-status').first().textContent();
  expect(status).toContain('success');
  
  await page.waitForTimeout(2);
  await page.close();
});

test('offline mode preserves state', async () => {
  const page = await chromium.launch({ url: KFORGE_URL });
  
  // Enable offline mode (simulated)
  await page.setOption('offline', true);
  
  // Perform an action
  await page.click('#save-task');
  
  // Switch to offline mode
  await page.setOption('offline', true);
  
  // Verify data persists
  const savedTasks = await page.evaluate(() => {
    return document.querySelectorAll('#tasks .saved-task').length;
  });
  expect(savedTasks).greaterThan(0);
  
  // Simulate network interruption
  await page.setOption('network', 'offline');
  
  // Action should still work
  await page.click('#save-task');
  
  // Restore online
  await page.setOption('network', 'online');
  
  await page.close();
});
