import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { readSelectedElementContext, runtimeMessageMatchesPending, withSelectedElementContext } from "@/lib/report-element-context";
import { composeWebReportSrcDoc } from "@/lib/report-web";

function verifyPickerProtocol() {
  const source = composeWebReportSrcDoc({ "page.html": "<!doctype html><html><body><main data-report-root><h1>经营总览</h1></main></body></html>" }, { workspaceFingerprint: "current-version" });
  const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script);
  assert.match(script, /__DATATALK_SET_ELEMENT_PICKER__/);
  assert.match(script, /__DATATALK_ELEMENT_SELECTED__/);
  assert.match(script, /__DATATALK_CLEAR_ELEMENT_PICKER_HOVER__/);
  assert.match(script, /if \(elementPickerHoverTarget\) \{\s*elementPickerHoverTarget = null;\s*refreshElementPickerOutline\(\);/);
  assert.match(script, /Array\.isArray\(payload\.selectedSelectors\)/);
  assert.doesNotMatch(script, /contextSelectionEnabled/);
  const frameSource = readFileSync(new URL("../components/report-web-frame.tsx", import.meta.url), "utf8");
  assert.match(frameSource, /window\.addEventListener\("pointermove", clearHover, \{ capture: true \}\)/);
  assert.match(frameSource, /postMessage\(\{ type: "__DATATALK_CLEAR_ELEMENT_PICKER_HOVER__" \}/);

  const start = script.indexOf("let elementPickerEnabled = false;");
  const end = script.indexOf("function listPreviewElements(", start);
  assert.ok(start >= 0 && end > start);

  const handlers = new Map<string, (event: any) => void>();
  const windowHandlers = new Map<string, (event: any) => void>();
  const messages: Array<{ type?: string; target?: { selector?: string; workspaceFingerprint?: string } }> = [];
  class TestElement {
    isConnected = true;
    children: TestElement[] = [];
    style: Record<string, string> = {};
    constructor(readonly selector: string, readonly tagName: string, readonly textContent: string, readonly parent: TestElement | null = null) {}
    get parentElement() { return this.parent; }
    closest() { return this; }
    contains(element: TestElement) { return element === this || element.parent === this; }
    getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 40 }; }
    setAttribute() {}
  }
  class TestHtmlElement extends TestElement {}
  const root = new TestHtmlElement("main", "MAIN", "", null);
  const heading = new TestHtmlElement("h1", "H1", "经营总览", root);
  const paragraph = new TestHtmlElement("p", "P", "销售额", root);
  root.children = [heading, paragraph];
  const outlines: TestHtmlElement[] = [];
  let pickerCursorActive = false;
  const documentElement = {
    appendChild(element: TestHtmlElement) { if (element.tagName === "DIV") outlines.push(element); },
    toggleAttribute(name: string, enabled: boolean) { if (name === "data-datatalk-element-picker-active") pickerCursorActive = enabled; },
    querySelectorAll: () => [],
  };
  const document = {
    documentElement,
    createElement: (tag: string) => new TestHtmlElement("outline", tag.toUpperCase(), ""),
    addEventListener: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); },
  };
  const window = {
    addEventListener(type: string, handler: (event: any) => void) { windowHandlers.set(type, handler); },
    parent: { postMessage: (message: { type?: string; target?: { selector?: string; workspaceFingerprint?: string } }) => { messages.push(message); } },
  };
  const picker = vm.runInNewContext(`(() => { ${script.slice(start, end)}; return { setEnabled: (value) => { elementPickerEnabled = value; setElementPickerCursor(value); refreshElementPickerOutline(); }, isEnabled: () => elementPickerEnabled, setSelectedSelectors: (value) => { elementPickerSelectedSelectors = value; refreshElementPickerOutline(); } }; })()`, {
    Element: TestElement,
    document,
    window,
    getReportContentRoot: () => root,
    previewElementSelector: (element: TestElement) => element.selector,
    describePreviewElement: (selector: string) => ({ selector, tag: selector === "p" ? "p" : "h1", text: selector === "p" ? "销售额" : "经营总览" }),
    isVisible: () => true,
    resolvePreviewElement: (selector: string) => selector === "main" ? root : selector === "p" ? paragraph : heading,
    reportContext: { workspaceFingerprint: "current-version" },
    fixedCanvasSpacePressed: false,
    fixedCanvasPanPointerId: null,
  }) as { setEnabled: (value: boolean) => void; isEnabled: () => boolean; setSelectedSelectors: (value: string[]) => void };

  const click = handlers.get("click");
  assert.ok(click);
  const event = {
    target: heading, button: 0, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  click(event);
  assert.equal(messages.length, 0);
  assert.equal(event.prevented, false);
  assert.equal(handlers.has("contextmenu"), false);
  picker.setEnabled(true);
  assert.equal(pickerCursorActive, true);
  handlers.get("pointermove")?.({ target: heading });
  assert.equal(outlines[0].style.border, "2px dashed #0e9384");
  windowHandlers.get("pointerout")?.({ relatedTarget: paragraph });
  assert.equal(outlines[0].style.display, "block");
  windowHandlers.get("pointerout")?.({ relatedTarget: null });
  assert.equal(outlines[0].style.display, "none");
  click(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(messages.at(-1)?.target?.selector, "h1");
  assert.equal(outlines[0].style.border, "2px solid #2167e8");
  handlers.get("pointermove")?.({ target: paragraph });
  assert.equal(outlines[1].style.border, "2px dashed #0e9384");
  click({ ...event, target: paragraph });
  assert.equal(messages.at(-1)?.target?.selector, "p");
  assert.equal(outlines[1].style.border, "2px solid #2167e8");
  assert.equal(outlines.length, 2);
  assert.equal(picker.isEnabled(), true);
  click({ ...event, target: heading });
  assert.equal(outlines.length, 2);
  picker.setSelectedSelectors(["p"]);
  assert.equal(outlines[0].style.display, "block");
  assert.equal(outlines[1].style.display, "none");
  picker.setSelectedSelectors([]);
  assert.equal(outlines[0].style.display, "none");
  assert.equal(messages.at(-1)?.type, "__DATATALK_ELEMENT_SELECTED__");
  assert.equal(messages.at(-1)?.target?.selector, "h1");
  assert.equal(messages.at(-1)?.target?.workspaceFingerprint, "current-version");
  const unnamed = new TestHtmlElement("x".repeat(501), "SPAN", "长路径节点", root);
  picker.setEnabled(true);
  click({ ...event, target: unnamed });
  assert.equal(messages.at(-1)?.target?.selector, "main");
  handlers.get("keydown")?.({ key: "Escape" });
  assert.equal(messages.at(-1)?.type, "__DATATALK_ELEMENT_PICKER_CANCEL__");
  assert.equal(picker.isEnabled(), false);
  assert.equal(pickerCursorActive, false);
}

function verifyChatContext() {
  const selected = { selector: 'article[data-widget-id="sales"]', tag: "article", text: "销售额", workspaceFingerprint: "current-version" };
  const second = { selector: 'section[data-widget-id="trend"]', tag: "section", text: "销售趋势", workspaceFingerprint: "current-version" };
  assert.equal(withSelectedElementContext("这个指标太小", []), "这个指标太小");
  const prompt = withSelectedElementContext("这个指标太小", [selected, second]);
  assert.ok(prompt.includes('"selector":"article[data-widget-id=\\"sales\\"]"'));
  assert.deepEqual(readSelectedElementContext(prompt), { message: "这个指标太小", selected: [selected, second] });
  const runtimePrompt = prompt.replace(/\n/g, "\r\n");
  assert.deepEqual(readSelectedElementContext(runtimePrompt), { message: "这个指标太小", selected: [selected, second] });
  assert.equal(runtimeMessageMatchesPending(runtimePrompt, prompt), true);
  assert.equal(runtimeMessageMatchesPending(`${runtimePrompt}\r\n\r\n本轮对话包含以下临时附件：\r\n- 参考图片.png`, prompt), true);
  assert.equal(runtimeMessageMatchesPending("另一个请求", prompt), false);
  assert.deepEqual(readSelectedElementContext(withSelectedElementContext("", [selected])), { message: "", selected: [selected] });
  const withAttachment = `${prompt}\n\n本轮对话包含以下临时附件：\n- 参考图片.png`;
  assert.deepEqual(readSelectedElementContext(withAttachment), { message: "这个指标太小\n\n本轮对话包含以下临时附件：\n- 参考图片.png", selected: [selected, second] });
  const legacyPrompt = `这个指标太小\n\n当前选中的报表元素（定位信息，请核对最新 working 页面）：\n${JSON.stringify(selected)}`;
  assert.deepEqual(readSelectedElementContext(legacyPrompt), { message: "这个指标太小", selected: [selected] });
  assert.deepEqual(readSelectedElementContext("普通消息"), { message: "普通消息", selected: [] });
  assert.deepEqual(readSelectedElementContext(`${prompt}后续内容`), { message: "这个指标太小", selected: [] });
  assert.deepEqual(readSelectedElementContext(withSelectedElementContext("无效目标", [selected, { ...second, selector: "x".repeat(501) }])), { message: "无效目标", selected: [] });
  assert.deepEqual(readSelectedElementContext(`无效目标\r\n\r\n当前选中的报表元素（定位信息，请核对最新 working 页面）：\r\n[broken`), { message: "无效目标", selected: [] });
}

verifyPickerProtocol();
verifyChatContext();
console.log("Report element selection contract passed");
