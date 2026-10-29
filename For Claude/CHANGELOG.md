# Version 1.1 WebGL production revision

- Replaced the Python desktop production plan with TypeScript, PixiJS WebGL2 and Vite.
- Preserved the default puzzle rules, proposed 19-piece catalog, visual direction and task IDs.
- Replaced native file saves with transactional IndexedDB and explicit multi-tab conflict handling.
- Added pointer capture, touch lift, responsive DOM controls, DPR mapping and visibility handling.
- Added audio gesture unlock, graphics context recovery and browser/device release checks.
- Replaced editable executable-adjacent files with versioned hosted content and a deployment index.
- Replaced native packaging tasks with static build, HTTP verification, HTTPS deployment and rollback.
- Specified xorshift32_v1 for cross-browser replay. No prior game code or saves are claimed migrated.
- PWA offline install and a desktop wrapper remain optional later tasks.
