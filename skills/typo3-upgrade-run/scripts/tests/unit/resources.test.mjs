import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeClaims, claimsConflict, blockedClaims, acquireClaims, releaseClaims } from '../../lib/run/resources.mjs';

const modern = { policy: { serialize_mutations: true, shared_proof_reads: true } };
test('frozen readers overlap, mutations and quiet performance measurements do not', () => {
  const reader = nodeClaims({ freeze: true }, modern);
  assert.equal(claimsConflict(reader, reader), false);
  assert.equal(claimsConflict(reader, nodeClaims({ mutation: 'code' }, modern)), true);
  assert.equal(claimsConflict(reader, nodeClaims({ mutation: 'stateful' }, modern)), true);
  assert.equal(claimsConflict(reader, nodeClaims({ quiet: true, freeze: true }, modern)), true);
  assert.equal(claimsConflict(reader, nodeClaims({ freeze: true, resources: ['project-write'] }, modern)), true);
});
test('legacy frozen proofs retain their exclusive locks', () => {
  const claims = nodeClaims({ freeze: true }, { policy: { serialize_mutations: true } });
  assert.deepEqual(claims, [{ resource: 'project-write', mode: 'exclusive' }]);
  assert.equal(claimsConflict(claims, claims), true);
});
test('releasing one reader does not release another reader or allow a writer', () => {
  const locks = {}, reader = nodeClaims({ freeze: true }, modern), writer = nodeClaims({ mutation: 'code' }, modern);
  acquireClaims(locks, reader, 'a'); acquireClaims(locks, reader, 'b');
  releaseClaims(locks, 'a');
  assert.deepEqual(locks['project-write'], { readers: ['b'] });
  assert.equal(blockedClaims(writer, locks).length, 1);
  releaseClaims(locks, 'b');
  assert.deepEqual(locks, {});
  assert.deepEqual(blockedClaims(writer, locks), []);
});
