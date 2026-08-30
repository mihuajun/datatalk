(() => {
  let nextId = 0;

  const isValue = (value) => (typeof value === "string" && value.trim() !== "") || typeof value === "number";
  const optionKey = (value) => `${typeof value}:${String(value)}`;
  const normalizeValues = (values) => [...new Map(
    (Array.isArray(values) ? values : [])
      .filter(isValue)
      .map((value) => [optionKey(value), value]),
  ).values()];
  const normalizeOptions = (input) => {
    const source = Array.isArray(input) ? input : Array.isArray(input?.options) ? input.options : [];
    return source
      .map((item) => {
        const value = typeof item === "object" && item !== null ? item.value : item;
        const label = typeof item === "object" && item !== null ? item.label : item;
        return isValue(value) ? { value, label: isValue(label) ? String(label) : String(value) } : null;
      })
      .filter(Boolean);
  };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character]));

  function createSearchableMultiSelect(config) {
    const host = typeof config.root === "string" ? document.querySelector(config.root) : config.root;
    if (!host) throw new Error("searchable multi-select root not found");
    if (typeof config.fetchOptions !== "function") throw new Error("searchable multi-select fetchOptions is required");

    const id = `fd-ms-${++nextId}`;
    const label = String(config.label || "筛选项");
    const placeholder = String(config.placeholder || `搜索${label}`);
    const maxOptions = Math.max(1, Number(config.maxOptions) || 30);
    const state = {
      values: normalizeValues(config.values),
      options: new Map(),
      keyword: "",
      open: false,
      disabled: false,
      requestId: 0,
      searchTimer: null,
    };

    host.classList.add("fd-multi-select");
    host.innerHTML = `
      <div class="fd-ms-control">
        <button type="button" class="fd-ms-trigger" aria-label="${escapeHtml(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-menu">
          <span class="fd-ms-value is-placeholder" data-value>${escapeHtml(placeholder)}</span>
          <span class="fd-ms-count" data-count hidden></span>
          <span class="fd-ms-chevron" aria-hidden="true"></span>
        </button>
        <button type="button" class="fd-ms-clear" data-clear aria-label="清空${escapeHtml(label)}" hidden>×</button>
      </div>
      <div class="fd-ms-menu" id="${id}-menu" hidden>
        <div class="fd-ms-search">
          <input id="${id}-search" type="search" aria-label="搜索${escapeHtml(label)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
        </div>
        <div class="fd-ms-options" data-options role="listbox" aria-label="${escapeHtml(label)}选项"></div>
        <div class="fd-ms-status" data-status aria-live="polite" hidden></div>
      </div>`;

    const control = host.querySelector(".fd-ms-control");
    const trigger = host.querySelector(".fd-ms-trigger");
    const clear = host.querySelector("[data-clear]");
    const menu = host.querySelector(".fd-ms-menu");
    const search = host.querySelector(".fd-ms-search input");
    const list = host.querySelector("[data-options]");
    const status = host.querySelector("[data-status]");

    const emit = (meta) => {
      if (typeof config.onChange === "function") config.onChange(state.values.slice(), meta);
    };

    const renderControl = () => {
      const valueNode = host.querySelector("[data-value]");
      const countNode = host.querySelector("[data-count]");
      const first = state.values[0];
      const hasValue = state.values.length > 0;
      valueNode.textContent = hasValue ? state.options.get(optionKey(first))?.label || String(first) : placeholder;
      valueNode.classList.toggle("is-placeholder", !hasValue);
      countNode.hidden = state.values.length < 2;
      countNode.textContent = state.values.length > 1 ? `+${state.values.length - 1}` : "";
      clear.hidden = !hasValue;
      host.classList.toggle("has-value", hasValue);
      trigger.setAttribute("aria-label", hasValue ? `${label}: ${state.values.join(", ")}` : label);
    };

    const setStatus = (message, error = false) => {
      status.hidden = !message;
      status.textContent = message;
      status.classList.toggle("is-error", error);
    };

    const renderOptions = () => {
      const selectedKeys = new Set(state.values.map(optionKey));
      const selectedOptions = state.values.map((value) => state.options.get(optionKey(value)) || ({ value, label: String(value) }));
      const merged = [...selectedOptions, ...state.options.values()]
        .filter((item, index, all) => all.findIndex((candidate) => optionKey(candidate.value) === optionKey(item.value)) === index)
        .slice(0, maxOptions);
      list.innerHTML = merged.map((item) => {
        const selected = selectedKeys.has(optionKey(item.value));
        return `<button type="button" class="fd-ms-option" role="option" aria-selected="${selected}" data-key="${escapeHtml(optionKey(item.value))}"><span class="fd-ms-option-label">${escapeHtml(item.label)}</span>${selected ? '<span class="fd-ms-check" aria-hidden="true">✓</span>' : ""}</button>`;
      }).join("");
      if (!merged.length && !status.textContent) setStatus("暂无匹配项");
      else if (merged.length && status.textContent === "暂无匹配项") setStatus("");
    };

    const refresh = async () => {
      const requestId = ++state.requestId;
      setStatus("搜索中…");
      list.innerHTML = "";
      try {
        const response = await config.fetchOptions({ keyword: state.keyword, values: state.values.slice() });
        if (requestId !== state.requestId) return;
        const nextOptions = new Map(normalizeOptions(response).map((item) => [optionKey(item.value), item]));
        for (const value of state.values) {
          const key = optionKey(value);
          if (!nextOptions.has(key) && state.options.has(key)) nextOptions.set(key, state.options.get(key));
        }
        state.options = nextOptions;
        renderControl();
        setStatus("");
        renderOptions();
      } catch {
        if (requestId !== state.requestId) return;
        state.options.clear();
        list.innerHTML = "";
        setStatus("选项加载失败", true);
      }
    };

    const open = () => {
      if (state.disabled) return;
      state.open = true;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      search.focus();
      void refresh();
    };

    const close = (restoreFocus = false) => {
      state.open = false;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) trigger.focus();
    };

    const toggleValue = (value) => {
      const key = optionKey(value);
      state.values = state.values.some((item) => optionKey(item) === key)
        ? state.values.filter((item) => optionKey(item) !== key)
        : [...state.values, value];
      renderControl();
      renderOptions();
      emit({ type: "toggle", value });
    };

    const onControlClick = (event) => {
      if (event.target.closest("[data-clear]")) return;
      if (event.target.closest(".fd-ms-trigger")) {
        if (state.open) close();
        else open();
      }
    };

    const onListClick = (event) => {
      const option = event.target.closest("[data-key]");
      if (!option) return;
      const item = state.options.get(option.dataset.key) || state.values.map((value) => ({ value, label: String(value) })).find((candidate) => optionKey(candidate.value) === option.dataset.key);
      if (item) toggleValue(item.value);
    };

    const onSearchInput = () => {
      state.keyword = search.value.trim();
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => void refresh(), 220);
    };

    const onDocumentClick = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (state.open && !host.contains(event.target) && !path.includes(host)) close();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape" && state.open) {
        event.preventDefault();
        close(true);
      }
    };

    trigger.addEventListener("click", onControlClick);
    clear.addEventListener("click", () => {
      state.values = [];
      renderControl();
      renderOptions();
      emit({ type: "clear" });
      if (state.open) void refresh();
      trigger.focus();
    });
    list.addEventListener("click", onListClick);
    search.addEventListener("input", onSearchInput);
    document.addEventListener("click", onDocumentClick);
    host.addEventListener("keydown", onKeyDown);

    renderControl();

    return {
      getValues: () => state.values.slice(),
      setValues(values) {
        state.values = normalizeValues(values);
        renderControl();
        if (state.open) void refresh();
        else renderOptions();
      },
      refresh,
      setDisabled(disabled) {
        state.disabled = Boolean(disabled);
        trigger.disabled = state.disabled;
        clear.disabled = state.disabled;
        if (state.disabled) close();
        control.setAttribute("aria-disabled", String(state.disabled));
      },
      close,
      destroy() {
        clearTimeout(state.searchTimer);
        document.removeEventListener("click", onDocumentClick);
        host.removeEventListener("keydown", onKeyDown);
        host.innerHTML = "";
      },
    };
  }

  window.createSearchableMultiSelect = createSearchableMultiSelect;
})();
