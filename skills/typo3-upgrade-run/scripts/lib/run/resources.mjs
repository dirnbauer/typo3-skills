/** One resource model for admission forecasts and actual graph transitions. */
export function nodeClaims(node, definition) {
  const claims = new Map((node.read_resources ?? []).map(resource => [resource, 'shared']));
  for (const resource of node.resources ?? []) claims.set(resource, 'exclusive');
  if (definition.policy?.serialize_mutations) {
    if (['code', 'stateful'].includes(node.mutation)) claims.set('project-write', 'exclusive');
    else if (node.freeze && !claims.has('project-write')) {
      claims.set('project-write', definition.policy.shared_proof_reads === true ? 'shared' : 'exclusive');
    }
  }
  // Opt-in on the sealed graph. Old definitions keep their original semantics.
  if (definition.policy?.shared_proof_reads === true) {
    claims.set('machine-load', node.quiet === true ? 'exclusive' : 'shared');
  }
  return [...claims].map(([resource, mode]) => ({ resource, mode }));
}

export function claimsConflict(left, right) {
  return left.some(a => right.some(b => a.resource === b.resource
    && (a.mode === 'exclusive' || b.mode === 'exclusive')));
}

export function lockOwners(lock) {
  return typeof lock === 'string' ? [lock] : Array.isArray(lock?.readers) ? lock.readers : [];
}

export function heldClaims(locks) {
  return Object.entries(locks).map(([resource, lock]) => ({
    resource, mode: typeof lock === 'string' ? 'exclusive' : 'shared',
  }));
}

export function blockedClaims(claims, locks) {
  const held = heldClaims(locks);
  return claims.filter(claim => claimsConflict([claim], held));
}

export function acquireClaims(locks, claims, owner) {
  for (const { resource, mode } of claims) {
    if (mode === 'exclusive') locks[resource] = owner;
    else locks[resource] = { readers: [...new Set([...lockOwners(locks[resource]), owner])].sort() };
  }
}

export function releaseClaims(locks, owner) {
  const released = [];
  for (const [resource, lock] of Object.entries(locks)) {
    if (!lockOwners(lock).includes(owner)) continue;
    const remaining = lockOwners(lock).filter(id => id !== owner);
    if (remaining.length) locks[resource] = { readers: remaining };
    else delete locks[resource];
    released.push(resource);
  }
  return released;
}
