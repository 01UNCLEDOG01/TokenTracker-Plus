// Compare explicit brand aliases, including the full pinyin of Chinese names.
// ASCII keys keep the same A-Z order across UI languages and JS runtimes.
export function getPerkSortKey(item) {
  if (!Array.isArray(item.sortNames) || item.sortNames.length === 0) {
    throw new TypeError(`Missing sortNames for perk ${item.id}`);
  }
  const keys = item.sortNames.map((name) => {
    if (typeof name !== "string" || !/^[A-Z][A-Z0-9]*(?: [A-Z0-9]+)*$/.test(name)) {
      throw new TypeError(`Invalid uppercase brand alias for perk ${item.id}`);
    }
    return name.replaceAll(" ", "");
  });
  return keys.sort()[0];
}

export function comparePerks(a, b) {
  const aKey = getPerkSortKey(a);
  const bKey = getPerkSortKey(b);
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
