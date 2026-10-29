# Agent execution agreement

This version specifies a TypeScript and PixiJS WebGL2 browser game. It includes planning, diagrams and example data, not implemented game code. Work one task at a time from the revised ledger.

## Read order

Read README.md, 01_GDD.md, 02_Agent_Roadmap.md and the task in tasks.json. Then inspect current repository decisions, handoffs and actual code. Use API documentation for pinned stable dependencies. Do not mix code examples from a moving development branch with the locked release. The GDD defines behavior; report any conflict before implementation.

## Before editing

State the task, prerequisite evidence, files, checks and unknowns. Follow Amit’s approval policy for changes to user-provided code. Authorized new work can proceed within its task scope. This document authorizes no live publication or account changes; prepare a concrete deployment candidate before seeking approval where needed.

## Implementation rules

Use strict TypeScript, readable data contracts, composition and explicit dependency passing. Keep rules independent of Pixi, DOM, IndexedDB, Web Audio and wall-clock time. Use interfaces at meaningful adapter boundaries. Do not add a generic engine, service locator or UI framework without a concrete need.

One command creates one complete logical transaction. Preview is read-only, animations are cosmetic and random deals use the versioned deterministic generator. Guard stale input and asynchronous callbacks with session/revision or generation IDs. Do not let hidden tabs or graphics restoration replay commands.

Use one Pointer Events path, consistent CSS-to-logical coordinate conversion and cancellable gestures. WebGL2 must be the actual renderer; a fallback backend cannot silently satisfy the release gate. Error and recovery screens must work in HTML when graphics fail.

Validate fetched JSON, pin a consistent content version per session and hash gameplay separately from presentation. Save through ordered IndexedDB transactions with storage revision guards. Never claim Saved before completion or assume tab-close callbacks will finish. Respect audio gesture policies and support silence.

## Finish one task

Run meaningful acceptance checks and affected regressions. Record commands and actual outputs, update the task ledger and write a handoff. Commit coherent changes when a repository is configured. Stop at the task boundary unless a batch is authorized. Browser emulation is not real-device evidence; a built dist directory is not verified hosting.

Never fabricate test results, API support, user approval, performance, asset provenance or deployment success. Keep unavailable checks NOT RUN. Optional offline/PWA work, native wrappers and final music are outside required completion unless separately requested.

## Handoff template

Task and status; starting and finishing commit; prerequisite evidence; files and reasons; behavior changed; exact checks and outputs; checks not run; evidence paths; rules/content/schema versions; defects and decisions; next ready task.

## Reusable execution prompt

Implement task <TASK_ID> from this WebGL pack. Read AGENTS.md, the GDD, selected task and prerequisite handoffs. Inspect the repository, state scope and checks, then perform authorized work. Keep deterministic rules separate from browser adapters. Run checks, record actual results and update the ledger and handoff. Stop at the task boundary. Do not invent approvals or publish without authorization.
