export const MARKDOWN_PREVIEW_CLOSE_SELECTOR =
  "[data-markdown-preview-close]";

interface ClosestEventTarget extends EventTarget {
  closest(selector: string): unknown;
}

function supportsClosest(target: EventTarget): target is ClosestEventTarget {
  return (
    "closest" in target &&
    typeof (target as { closest?: unknown }).closest === "function"
  );
}

export function shouldRecordMarkdownActivity(
  target: EventTarget | null
): boolean {
  return !(
    target &&
    supportsClosest(target) &&
    target.closest(MARKDOWN_PREVIEW_CLOSE_SELECTOR)
  );
}
