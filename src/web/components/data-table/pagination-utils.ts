export function getHeuristicPageCount(pageIndex: number, currentCount: number, pageSize: number) {
  const normalizedPageIndex = Math.max(pageIndex, 0);
  const hasNextPage = currentCount >= pageSize;

  return normalizedPageIndex + (hasNextPage ? 2 : 1);
}
