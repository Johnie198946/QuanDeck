/** UI grouping only: every check keeps its original task/item acceptance indexes. */
export interface ReviewCheckRow {
  text: string;
  taskIndexes: number[];
  itemIndexes: number[];
}

export function reviewChecklist(
  taskCriteria: string[],
  items: { id: string; criteria: string[]; canShare?: boolean }[],
) {
  const mergedTaskIndexes = new Set<number>();
  const itemRows = Object.fromEntries(
    items.map((item) => {
      const rows: ReviewCheckRow[] = [];
      item.criteria.forEach((text, itemIndex) => {
        // Use the full inventory, including optional/unsubmitted items. One received
        // file among several definitions must never imply a single-file review.
        const taskIndexes =
          items.length === 1 && item.canShare !== false && text.trim()
            ? taskCriteria.flatMap((criterion, index) =>
                criterion.trim() === text.trim() ? [index] : [],
              )
            : [];
        taskIndexes.forEach((index) => mergedTaskIndexes.add(index));
        const shared = taskIndexes.length
          ? rows.find((row) => row.taskIndexes.length && row.text.trim() === text.trim())
          : undefined;
        if (shared) shared.itemIndexes.push(itemIndex);
        else rows.push({ text, taskIndexes, itemIndexes: [itemIndex] });
      });
      return [item.id, rows];
    }),
  );
  const taskRows: ReviewCheckRow[] = taskCriteria.flatMap((text, index) =>
    mergedTaskIndexes.has(index) ? [] : [{ text, taskIndexes: [index], itemIndexes: [] }],
  );
  return { taskRows, itemRows, hasSharedChecks: mergedTaskIndexes.size > 0 };
}

export function reviewCheckSelected(row: ReviewCheckRow, task: boolean[], item: boolean[] = []) {
  return (
    row.taskIndexes.every((index) => task[index] === true) &&
    row.itemIndexes.every((index) => item[index] === true)
  );
}

export function updateReviewChecks(values: boolean[], indexes: number[], checked: boolean) {
  return values.map((value, index) => (indexes.includes(index) ? checked : value));
}
