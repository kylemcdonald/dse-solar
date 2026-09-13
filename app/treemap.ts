export type TreemapTile<Item> = { item: Item; x: number; y: number; width: number; height: number };

export function buildTreemap<Item>(
  items: readonly Item[],
  valueFor: (item: Item) => number,
  x = 0,
  y = 0,
  width = 100,
  height = 100,
): TreemapTile<Item>[] {
  if (!items.length) return [];
  if (items.length === 1) return [{ item: items[0], x, y, width, height }];
  const sorted = [...items].sort((a, b) => valueFor(b) - valueFor(a));
  const total = sorted.reduce((sum, item) => sum + valueFor(item), 0);
  let splitIndex = 1;
  let firstValue = valueFor(sorted[0]);
  while (splitIndex < sorted.length - 1 && firstValue + valueFor(sorted[splitIndex]) <= total / 2) {
    firstValue += valueFor(sorted[splitIndex]);
    splitIndex += 1;
  }
  const ratio = firstValue / total;
  const first = sorted.slice(0, splitIndex);
  const second = sorted.slice(splitIndex);
  if (width >= height) {
    const firstWidth = width * ratio;
    return [
      ...buildTreemap(first, valueFor, x, y, firstWidth, height),
      ...buildTreemap(second, valueFor, x + firstWidth, y, width - firstWidth, height),
    ];
  }
  const firstHeight = height * ratio;
  return [
    ...buildTreemap(first, valueFor, x, y, width, firstHeight),
    ...buildTreemap(second, valueFor, x, y + firstHeight, width, height - firstHeight),
  ];
}
