# 1010 inspired WebGL production planning pack

Prepared for Amit on 29 October 2026. Version 1.1 supersedes the Python planning direction. Reference: Gram Games’ 1010! classic endless mode. Working title: Line Garden.

Production stack: strict TypeScript, PixiJS using WebGL2, Vite, Vitest and Playwright. Target: an HTTPS-hosted browser game with desktop mouse/keyboard and mobile touch support. Pure puzzle rules remain independent of browser APIs. The default board, tray cycle, proposed scoring and 19-piece catalog are unchanged.

## Contents

- 01_GDD.md: design, reference analysis, rules, original art direction and browser production architecture.
- 02_Agent_Roadmap.md and tasks.json: 30 revised tasks with dependencies, scope, acceptance and evidence.
- AGENTS.md: working agreement and execution prompt.
- rules.example.json and pieces.example.json: gameplay and deterministic generator baseline.
- theme.example.json and runtime.example.json: original presentation and browser layout/input defaults.
- audio.example.json: optional gesture-gated global music and effects, intentionally empty.
- content_index.example.json and content_manifest.example.json: proposed versioned content loading contract.
- figures: original layout and catalog schematics.
- SOURCES.md: game and browser references.
- CONFIGURATION.md: operator content updates and compatibility rules.
- WEB_DEPLOYMENT.md: build, host verification and rollback checklist.
- CHANGELOG.md: version 1.1 migration decisions.

## Start

Extract into a fresh folder. Ask the coding agent to execute T01 following AGENTS.md. Preserve task IDs when importing the revised ledger, but review any existing implementation before applying new task status. All tasks here are not_started because this pack contains no implementation evidence.

## Delivery status and boundaries

No executable JavaScript application, Python engine or playable build is included. The output planned by the tasks is a static dist directory plus source and documentation. Run a production build through HTTP or HTTPS, not by double-clicking index.html. There is no required game backend or account system.

Initial loading requires the network. Offline reload/PWA installation and native desktop wrappers are optional future tasks. Browser saves remain local to the origin and browser profile. Final title and optional audio remain later inputs; music is not required for a playable release.
