# KNOuX Forge run guide

1. Install the locked dependencies with `npm ci`.
2. Set `KFORGE_WORKSPACE_ROOT` in the process environment to the parent directory containing repositories KForge should discover. If omitted, KForge uses the parent of its current working directory.
3. Start development with `npm run dev`, then open `http://localhost:8080/workspace`.
4. For production, run `npm run build` and then `npm start`. The production server uses `PORT` or defaults to `3000`.

Repository-native verification:

```text
npm run typecheck
npm test
npm run build
```

Additional scripts are `build:client`, `build:server`, and `format.fix`. There is no repository `lint` script. Remote providers, registries, GitHub reads, and remote writes require their own configuration and explicit product gates; starting KForge does not contact them.
