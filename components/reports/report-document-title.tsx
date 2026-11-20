"use client";

import { useEffect } from "react";

/** Keep the top-level tab title in sync, not just the report iframe title. */
export function useReportDocumentTitle(name?: string | null) {
  useEffect(() => {
    const title = name?.trim();
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      // Do not overwrite a title installed by the next route during navigation.
      if (document.title === title) document.title = previous;
    };
  }, [name]);
}
