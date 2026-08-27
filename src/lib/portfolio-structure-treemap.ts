export type PortfolioTreemapInput = Readonly<{
  key: string;
  value: number;
}>;

export type PortfolioTreemapRect = Readonly<{
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type AreaItem = Readonly<{
  key: string;
  area: number;
}>;

type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export function layoutPortfolioTreemap(
  inputs: readonly PortfolioTreemapInput[],
  width = 100,
  height = 56,
): readonly PortfolioTreemapRect[] {
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return [];

  const usable = inputs
    .filter((input) => input.key.trim() && isPositiveFinite(input.value))
    .toSorted(
      (left, right) =>
        right.value - left.value || left.key.localeCompare(right.key),
    );
  const total = usable.reduce((sum, input) => sum + input.value, 0);
  if (!isPositiveFinite(total)) return [];

  const scale = (width * height) / total;
  const remainingItems: AreaItem[] = usable.map((input) => ({
    key: input.key,
    area: input.value * scale,
  }));
  const result: PortfolioTreemapRect[] = [];
  let bounds: Bounds = { x: 0, y: 0, width, height };
  let row: AreaItem[] = [];

  while (remainingItems.length > 0) {
    const next = remainingItems[0];
    const shortSide = Math.min(bounds.width, bounds.height);
    if (
      row.length === 0 ||
      worstAspectRatio([...row, next], shortSide) <=
        worstAspectRatio(row, shortSide)
    ) {
      row.push(next);
      remainingItems.shift();
      continue;
    }

    const laidOut = layoutRow(row, bounds);
    result.push(...laidOut.rects);
    bounds = laidOut.remaining;
    row = [];
  }

  if (row.length > 0) {
    result.push(...layoutRow(row, bounds).rects);
  }

  return Object.freeze(result.map((rect) => Object.freeze(rect)));
}

function worstAspectRatio(row: readonly AreaItem[], shortSide: number) {
  if (row.length === 0 || !isPositiveFinite(shortSide)) {
    return Number.POSITIVE_INFINITY;
  }
  const sum = row.reduce((total, item) => total + item.area, 0);
  const max = Math.max(...row.map((item) => item.area));
  const min = Math.min(...row.map((item) => item.area));
  const sideSquared = shortSide * shortSide;
  const sumSquared = sum * sum;
  return Math.max(
    (sideSquared * max) / sumSquared,
    sumSquared / (sideSquared * min),
  );
}

function layoutRow(
  row: readonly AreaItem[],
  bounds: Bounds,
): { rects: PortfolioTreemapRect[]; remaining: Bounds } {
  const area = row.reduce((sum, item) => sum + item.area, 0);
  if (bounds.width >= bounds.height) {
    const stripWidth = area / bounds.height;
    let y = bounds.y;
    const rects = row.map((item, index) => {
      const itemHeight =
        index === row.length - 1
          ? bounds.y + bounds.height - y
          : item.area / stripWidth;
      const rect = {
        key: item.key,
        x: bounds.x,
        y,
        width: stripWidth,
        height: itemHeight,
      };
      y += itemHeight;
      return rect;
    });
    return {
      rects,
      remaining: {
        x: bounds.x + stripWidth,
        y: bounds.y,
        width: Math.max(0, bounds.width - stripWidth),
        height: bounds.height,
      },
    };
  }

  const stripHeight = area / bounds.width;
  let x = bounds.x;
  const rects = row.map((item, index) => {
    const itemWidth =
      index === row.length - 1
        ? bounds.x + bounds.width - x
        : item.area / stripHeight;
    const rect = {
      key: item.key,
      x,
      y: bounds.y,
      width: itemWidth,
      height: stripHeight,
    };
    x += itemWidth;
    return rect;
  });
  return {
    rects,
    remaining: {
      x: bounds.x,
      y: bounds.y + stripHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - stripHeight),
    },
  };
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}
