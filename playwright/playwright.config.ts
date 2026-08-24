import { defineConfig } from 'playwright';
import { chi } from 'chi';

// Playwright configuration for KForge E2E tests
const playwrightConfig = {
  // Base URL for KForge application
  baseURL: 'http://localhost:8081',
  
  // Default browser settings
  defaultCommandTimeout: 30,
  
  // Retry configuration for flaky tests
  retries: {
    count: 2,
    delay: 1
  },
  
  // Test environment
  environment: {
    // Node.js version for tests
    node: 'latest'
  },
  
  // WebSocket configuration for real-time updates
  websocket: {
    enabled: true
  },
  
  // Headless configuration
  headless: {
    enabled: true,
    arguments: ['--no-sandbox', '--disable-setuid-sandbox']
  }
};

export default playwrightConfig;
