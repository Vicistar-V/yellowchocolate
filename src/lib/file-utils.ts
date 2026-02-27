export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export interface FileItem {
  id: string;
  file: File;
  pageCount: number | null;
  sizeFormatted: string;
}

/**
 * Stagger-add items into state one-by-one over a max duration for a smooth entrance UX.
 */
export async function staggerAddFiles<T>(
  items: T[],
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  options?: { maxDuration?: number; maxDelay?: number }
) {
  const { maxDuration = 2000, maxDelay = 400 } = options ?? {};
  const delayPerFile = Math.min(maxDuration / items.length, maxDelay);

  for (let i = 0; i < items.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayPerFile));
    setter((prev) => [...prev, items[i]]);
  }
}
