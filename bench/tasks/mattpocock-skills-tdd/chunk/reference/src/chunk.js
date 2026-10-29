export function chunk(items, size) {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('size must be a positive integer');
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}
