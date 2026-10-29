# Web release and deployment checklist

This guide describes required implementation work, not an existing deployment. No host has been selected or published by this planning task.

## Build contract

The repository must provide npm ci, npm run typecheck, npm test, npm run test:browser and npm run build. Document the local production preview command. Commit the package lock and pin the Node/package-manager versions. dist contains the full static site. Vite preview is only a local preview server.

## Hosting contract

Serve over HTTPS in production. Verify the configured app base, especially /line-garden/ or another nested path. Serve JavaScript, JSON, fonts and audio with correct MIME types; missing files must return an actual error, not HTML disguised as success. Keep required content same-origin. Record the static host and actual headers used.

Use revalidation for index.html and content/index.json. Cache hashed bundles and versioned content immutably. Upload complete immutable assets before switching entry pointers. Retain the prior release for rollback and open tabs. No service worker is required in v1.1.

## Acceptance before publication

Verify loading, exact WebGL2 renderer selection, unsupported GPU error, all menus, full run and game-over, touch/keyboard controls, audio unlock, IndexedDB restore and conflicts, context recovery, cold load and network failures. Use actual required desktop and mobile devices. Review the concrete candidate with Amit and obtain publication authorization where not already given.

## Hosted verification and rollback

After authorized deployment, test a fresh profile, normal reload, nested URLs, cached old-tab behavior and versioned content update. Compare commit/content IDs with the release manifest. Roll back by restoring the previous HTML/assets entry and compatible content index; do not delete live content used by old tabs. Verify the restored release and save compatibility. Pending host/device checks stay NOT RUN.

## Future extensions

PWA support requires offline asset coverage, versioned caches, a safe update prompt and save compatibility tests. A downloadable desktop wrapper is separate packaging work. Neither is included in the v1.1 release claim.
