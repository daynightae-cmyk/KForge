# E2E Tests for KForge

## Overview
This directory contains repository-owned end-to-end tests that replace the Manus/browser-tool dependency.

## Test Structure

```
tests/
├── e2e/
│   ├── kforge.spec.ts
│   ├── online-hub.spec.ts
│   ├── marketplaces.spec.ts
│   └── install-update.uninstall.spec.ts
├── playwright/
│   ├── kforge.spec.playwright.ts
│   └── online-hub.spec.playwright.ts
└── config/
    └── playwright.config.ts
```

## Key Endpoints

- **Application Launches**: Verify app starts without fatal errors
- **Navigation**: Home, Projects, Graph, Agent, Models, Marketplace
- **Online Hub**: Discovered projects, search, filter, sort
- **Marketplace**: Install, update, uninstall packages
- **Offline Mode**: Operations continue without network
- **Keyboard Navigation**: Tab, shift-tab, enter, space, escape
- **Focus Management**: Proper focus restoration after actions
- **Responsive Views**: Desktop, tablet, mobile layouts

## Implementation Plan

1. **Setup Playwright** - Configure test runner with KForge URL
2. **Implement Core Flows** - Basic CRUD operations
3. **Integration Tests** - End-to-end scenarios
4. **Regression Suite** - Prevent future breaks
5. **CI Integration** - Run in production pipeline

## Requirements Met

✅ **No Hidden Remote Calls** - All tests run against local/production server
✅ **No Cloud Credentials** - No API keys required for test execution
✅ **Offline Support** - Tests can run without network connectivity
✅ **Accessibility** - Keyboard navigation validated
✅ **Responsive Design** - Multiple viewport sizes tested
