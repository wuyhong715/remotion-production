import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {VIDEO_LIMIT} from '../scripts/plan.mjs';

const read = async (name) => parse(await readFile(`.github/workflows/${name}.yml`, 'utf8'));
const render = await read('render');
const ci = await read('ci');
assert.deepEqual(Object.keys(render.on), ['workflow_dispatch']);
assert.deepEqual(render.concurrency, {group: 'remotion-production-render', queue: 'max'});
assert.deepEqual(Object.keys(render.jobs), ['prepare', 'video', 'audio', 'assemble']);
assert.equal(VIDEO_LIMIT + 1, 16);
assert.equal(render.jobs.video.strategy['max-parallel'], VIDEO_LIMIT);
assert.equal(render.jobs.video.strategy.matrix, '${{ fromJSON(needs.prepare.outputs.matrix) }}');
assert.equal(render.jobs.video.needs, 'prepare');
assert.equal(render.jobs.audio.needs, 'prepare');
assert.equal(render.jobs.audio.strategy, undefined);
assert.deepEqual(render.jobs.assemble.needs, ['prepare', 'video', 'audio']);
const plan = render.jobs.prepare.steps.find((step) => step.id === 'plan');
assert.equal(plan.env.COMPOSITION, '${{ inputs.composition }}');
assert.equal(plan.env.SHARDS, '${{ inputs.shards }}');
for (const workflow of [render, ci]) {
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.run) assert.doesNotMatch(step.run, /\$\{\{/);
      if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    }
  }
}
assert.deepEqual(Object.keys(ci.on), ['push', 'pull_request']);
console.log('workflow policy OK: repository-wide queue; at most 15 concurrent video jobs plus one audio job');
