// Try the synchronous selection-copy path within the click gesture first. Some
// desktop webviews deny Clipboard API even though selection-copy is available.
export async function copyTextWithFallback(text: string): Promise<boolean> {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = document.createElement("textarea");
  input.value = text; input.readOnly = true;
  input.style.cssText = "position:fixed;left:0;top:0;opacity:0;width:1px;height:1px;pointer-events:none";
  document.body.appendChild(input);
  try {
    input.focus(); input.select(); input.setSelectionRange(0, text.length);
    if (document.execCommand("copy")) return true;
  } catch { /* Continue to the modern API, then visible manual-copy UI. */ }
  finally { input.remove(); previous?.focus({ preventScroll: true }); }
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}
