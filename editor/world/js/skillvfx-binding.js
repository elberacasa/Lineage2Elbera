// Elbera Tools: exact original Agent lookup, independent of rendering support.
// Agent +0x74 = FlyingTime; see docs/native-cast-agent-evidence.md.
export function skillAgentBinding(index, id, level) {
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(level) || level <= 0
      || index?.format !== 'l2-interlude-skill-vfx-v2') {
    return { status: 'missing-exact-metadata', path: null, entry: null };
  }
  const binding = index.bindings?.[String(id)];
  if (!Array.isArray(binding?.levels) || !binding.levels.includes(level)) {
    return { status: 'missing-exact-metadata', path: null, entry: null };
  }
  const path = Object.hasOwn(binding.overrides || {}, String(level))
    ? binding.overrides[String(level)] : binding.path;
  if (typeof path !== 'string') return { status: 'missing-exact-metadata', path: null, entry: null };
  if (!path || path.toLowerCase() === 'none') return { status: 'source-none', path, entry: null };
  const entry = index.objects?.[path.toLowerCase()];
  if (!entry || entry.path?.toLowerCase() !== path.toLowerCase() || !Number.isFinite(entry.f)) {
    return { status: 'unresolved-source-path', path, entry: null };
  }
  return { status: 'resolved-source-object', path, entry };
}

export function skillAgentFlyingTime(index, id, level) {
  const result = skillAgentBinding(index, id, level);
  // No Agent means no FlyingTime property. Legacy projectile timing is a
  // separate native path; absence cannot authorize an instant impact.
  return result.entry?.f ?? null;
}
