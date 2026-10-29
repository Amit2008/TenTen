// Usage: node tools/set-task.mjs <TASK_ID> <status> [handoff_path]
import { readFileSync, writeFileSync } from 'node:fs';

const STATUSES = ['not_started', 'in_progress', 'blocked', 'needs_review', 'done'];
const [id, status, handoff] = process.argv.slice(2);
if (!id || !STATUSES.includes(status)) {
  console.error(`usage: set-task.mjs <TASK_ID> <${STATUSES.join('|')}> [handoff_path]`);
  process.exit(1);
}
const ledger = JSON.parse(readFileSync('tasks.json', 'utf8'));
const task = ledger.tasks.find((t) => t.id === id);
if (!task) throw new Error(`unknown task ${id}`);
task.status = status;
if (handoff) task.handoff = handoff;
writeFileSync('tasks.json', JSON.stringify(ledger, null, 2) + '\n');
console.log(`${id} -> ${status}`);
