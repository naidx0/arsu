import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunicationReplay } from './communications.js';

for (const [fault, flag] of [['packet_corrupt', 'integrityOk'], ['packet_drop', 'sequenceOk'], ['packet_replay', 'sequenceOk'], ['packet_stale', 'freshnessOk']] as const) {
  test(`${fault} is observable in receipts and clears only after repair`, () => {
    const replay = new CommunicationReplay();
    replay.tick(1000); replay.tick(2000);
    replay.inject(fault);
    for (let t = 3000; t <= 6000; t += 1000) replay.tick(t);
    assert.equal(replay.snapshot()[flag], false);
    assert.ok(replay.snapshot().receipts.some(r => r.outcome !== 'accepted'));
    replay.repair(7000);
    const fixed = replay.snapshot();
    assert.equal(fixed.integrityOk && fixed.sequenceOk && fixed.freshnessOk, true);
    assert.equal(fixed.epoch, 2);
    assert.ok(fixed.receipts.some(r => r.outcome === 'rejected' || r.outcome === 'omitted'));
  });
}

test('healthy replay has bounded immutable evidence and never claims a real wire protocol', () => {
  const replay = new CommunicationReplay();
  for (let t = 1000; t < 100000; t += 1000) replay.tick(t);
  const state = replay.snapshot();
  assert.equal(state.transport, 'in-process educational JSON replay');
  assert.ok(state.receipts.length <= 24);
  state.receipts[0].payload.text = 'changed';
  assert.notEqual(replay.snapshot().receipts[0].payload.text, 'changed');
});
