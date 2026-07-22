// Resolve a Higgsfield model id to its human label from a resolved catalog,
// falling back to the default-model name (empty id ⇒ server default) or the raw id.
export function modelLabel(models, id, defaultLabel) {
  if (!id) return `${defaultLabel} (default)`;
  const m = (models || []).find((x) => x.id === id);
  return m?.label || id;
}
