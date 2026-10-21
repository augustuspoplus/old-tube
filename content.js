(function () {
  const CURRENT_YEAR = new Date().getFullYear();
  const MIN_YEAR = 2005;

  let state = {
    enabled: false,
    years: [],      // Committed active years, e.g. ["2008", "2009"]
    draftYears: [], // Currently highlighted years waiting for Apply
    strictFilter: true,
    showSidebarWidget: true
  };

  let isUpdatingDOM = false;
  let filterTimeout = null;

  function normalizeYears(yearsInput) {
    if (!yearsInput) return [];
    const arr = Array.isArray(yearsInput) ? yearsInput : String(yearsInput).split(",");
    const cleaned = arr
      .map((y) => parseInt(String(y).trim(), 10))
      .filter((y) => !isNaN(y) && y >= MIN_YEAR && y <= CURRENT_YEAR);
    return [...new Set(cleaned)].sort((a, b) => a - b).map(String);
  }

  function formatYearsCompact(years) {
    const norm = normalizeYears(years).map((y) => parseInt(y, 10));
    if (!norm.length) return "";
    const ranges = [];
    let start = norm[0];
    let prev = norm[0];

    for (let i = 1; i <= norm.length; i++) {
      const curr = norm[i];
      if (curr === prev + 1) {
        prev = curr;
      } else {
        if (prev - start >= 2) {
          ranges.push(`${start}–${prev}`);
        } else if (prev > start) {
          ranges.push(`${start}, ${prev}`);
        } else {
          ranges.push(`${start}`);
        }
        start = curr;
        prev = curr;
      }
    }
    return ranges.join(", ");
  }

  // Strip existing before:YYYY... and after:YYYY... operators from a search query
  function stripDateOperators(query) {
    if (!query) return "";
    return query
      .replace(/\b(before|after):\d{4}(-\d{2}(-\d{2})?)?\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Extract years from URL or query if before:/after: operators are already present
  function detectYearsFromUrl(url, storedYears = []) {
    const ytYearsParam = url.searchParams.get("yt_year");
    if (ytYearsParam) {
      return normalizeYears(ytYearsParam.split(","));
    }
    const query = url.searchParams.get("search_query") || "";
    const afterMatch = query.match(/\bafter:(\d{4})-12-31\b/i);
    const beforeMatch = query.match(/\bbefore:(\d{4})-01-01\b/i);
    if (afterMatch && beforeMatch) {
      const minY = parseInt(afterMatch[1], 10) + 1;
      const maxY = parseInt(beforeMatch[1], 10) - 1;

      const normStored = normalizeYears(storedYears);
      if (normStored.length > 0) {
        const storedMin = parseInt(normStored[0], 10);
        const storedMax = parseInt(normStored[normStored.length - 1], 10);
        if (storedMin === minY && storedMax === maxY) {
          return normStored;
        }
      }

      if (minY === maxY) return [String(minY)];
      if (minY < maxY && maxY - minY <= 30) {
        const range = [];
        for (let y = minY; y <= maxY; y++) range.push(String(y));
        return range;
      }
    }
    return null;
  }

  // Build search query with YouTube's date operators spanning the min and max selected years
  function buildYearQuery(rawQuery, years) {
    const clean = stripDateOperators(rawQuery);
    const norm = normalizeYears(years);
    if (!norm.length) return clean;
    const minYear = parseInt(norm[0], 10);
    const maxYear = parseInt(norm[norm.length - 1], 10);
    return `${clean} after:${minYear - 1}-12-31 before:${maxYear + 1}-01-01`.trim();
  }

  // Keep the YouTube search bar & tab title completely clean of ugly before:/after: operators
  function cleanSearchBarAndTitle() {
    const inputs = document.querySelectorAll(
      'input#search, input[name="search_query"], input.ytSearchboxComponentInput'
    );
    inputs.forEach((input) => {
      if (document.activeElement === input) return;
      if (input.value && /\b(before|after):\d{4}/i.test(input.value)) {
        input.value = stripDateOperators(input.value);
      }
    });

    const yearsLabel = formatYearsCompact(state.years);
    if (/\b(before|after):\d{4}/i.test(document.title)) {
      const cleanedTitle = stripDateOperators(document.title);
      document.title =
        state.enabled && state.years.length
          ? cleanedTitle.replace(/ - YouTube$/i, ` (${yearsLabel}) - YouTube`)
          : cleanedTitle;
    }

    if (window.location.pathname === "/results") {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("search_query") || "";
      if (/\b(before|after):\d{4}/i.test(q)) {
        const cleanQ = stripDateOperators(q);
        url.searchParams.set("search_query", cleanQ);
        if (state.enabled && state.years.length) {
          url.searchParams.set("yt_year", state.years.join(","));
        } else {
          url.searchParams.delete("yt_year");
        }
        window.history.replaceState(window.history.state, "", url.toString());
      }
    }
  }

  // Commit and apply the selected years when Apply is clicked
  function applyYearsToSearch(yearsInput, forceEnable = true) {
    const url = new URL(window.location.href);
    const currentQ = url.searchParams.get("search_query") || "";
    const cleanQ = stripDateOperators(currentQ);

    const normalized = normalizeYears(yearsInput);
    state.years = normalized;
    state.draftYears = [...normalized];
    state.enabled = normalized.length > 0 && forceEnable;

    browser.storage.local.set({
      enabled: state.enabled,
      years: state.years,
      year: state.years[0] || "",
      strictFilter: state.strictFilter,
      showSidebarWidget: state.showSidebarWidget
    });

    if (window.location.pathname === "/results" && cleanQ) {
      const newQuery =
        state.enabled && state.years.length ? buildYearQuery(cleanQ, state.years) : cleanQ;
      if (state.enabled && state.years.length) {
        url.searchParams.set("yt_year", state.years.join(","));
      } else {
        url.searchParams.delete("yt_year");
      }
      url.searchParams.set("search_query", newQuery);
      window.location.href = url.toString();
      return;
    }

    updateAllUI();
    scheduleFilter(true);
  }

  // Toggle a year in draftYears without reloading until Apply is clicked
  function toggleDraftYear(yearStr) {
    const y = String(yearStr);
    state.draftYears = state.draftYears.includes(y)
      ? state.draftYears.filter((item) => item !== y)
      : normalizeYears([...state.draftYears, y]);
    updateAllUI();
  }

  // Intercept new searches when a year filter is active
  function setupSearchInterceptors() {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || !state.enabled || !state.years.length) return;
        const target = e.target;
        if (
          target &&
          target.tagName === "INPUT" &&
          (target.id === "search" ||
            target.name === "search_query" ||
            target.classList.contains("ytSearchboxComponentInput"))
        ) {
          const cleanVal = stripDateOperators(target.value);
          if (!cleanVal) return;
          e.preventDefault();
          e.stopPropagation();
          const searchUrl = new URL("https://www.youtube.com/results");
          searchUrl.searchParams.set("search_query", buildYearQuery(cleanVal, state.years));
          searchUrl.searchParams.set("yt_year", state.years.join(","));
          window.location.href = searchUrl.toString();
        }
      },
      true
    );

    document.addEventListener(
      "click",
      (e) => {
        if (!state.enabled || !state.years.length) return;
        const btn = e.target.closest(
          "button#search-icon-legacy, button.ytSearchboxComponentSearchButton"
        );
        if (!btn) return;
        const input = document.querySelector(
          'input#search, input[name="search_query"], input.ytSearchboxComponentInput'
        );
        if (input && input.value) {
          const cleanVal = stripDateOperators(input.value);
          if (!cleanVal) return;
          e.preventDefault();
          e.stopPropagation();
          const searchUrl = new URL("https://www.youtube.com/results");
          searchUrl.searchParams.set("search_query", buildYearQuery(cleanVal, state.years));
          searchUrl.searchParams.set("yt_year", state.years.join(","));
          window.location.href = searchUrl.toString();
        }
      },
      true
    );
  }

  // Check if video upload date matches ANY of the selected target years
  function matchesTargetYears(metadataText, titleText, targetYears) {
    const numericTargets = targetYears.map((y) => parseInt(y, 10)).filter((y) => !isNaN(y));
    if (!numericTargets.length) return true;

    const combined = `${metadataText} ${titleText}`;

    const yearsAgoMatch = combined.match(/(\d+)\s+years?\s+ago/i);
    if (yearsAgoMatch) {
      const yearsAgo = parseInt(yearsAgoMatch[1], 10);
      const estimatedYear = CURRENT_YEAR - yearsAgo;
      return numericTargets.some((target) => Math.abs(estimatedYear - target) <= 1);
    }

    if (/\b(\d+)\s+(months?|weeks?|days?|hours?|minutes?|seconds?)\s+ago\b/i.test(combined)) {
      return numericTargets.some(
        (target) => target === CURRENT_YEAR || target === CURRENT_YEAR - 1
      );
    }

    return true;
  }

  function scheduleFilter(resetProcessed = false) {
    if (resetProcessed) {
      document.querySelectorAll("[data-yf-checked]").forEach((el) => {
        el.removeAttribute("data-yf-checked");
      });
    }
    if (filterTimeout) clearTimeout(filterTimeout);
    filterTimeout = setTimeout(runStrictDOMFilter, 200);
  }

  function runStrictDOMFilter() {
    if (isUpdatingDOM) return;
    const isResults = window.location.pathname === "/results";
    const isWatch = window.location.pathname === "/watch";
    if (!isResults && !isWatch) return;

    isUpdatingDOM = true;

    try {
      cleanSearchBarAndTitle();

      const itemSelectors = isResults
        ? "ytd-video-renderer"
        : "#secondary ytd-compact-video-renderer, #secondary yt-lockup-view-model, #related ytd-compact-video-renderer, #related yt-lockup-view-model";

      const videoRenderers = document.querySelectorAll(itemSelectors);
      const shelves = document.querySelectorAll(
        "ytd-reel-shelf-renderer, ytd-shelf-renderer, ytd-horizontal-card-list-renderer"
      );

      if (!state.enabled || !state.years.length || !state.strictFilter) {
        videoRenderers.forEach((el) => el.classList.remove("yt-yf-hidden-by-year"));
        shelves.forEach((el) => el.classList.remove("yt-yf-hidden-by-year"));
        updateStatusCounters(0, videoRenderers.length);
        return;
      }

      const maxSelectedYear = Math.max(...state.years.map((y) => parseInt(y, 10)));
      if (maxSelectedYear < CURRENT_YEAR) {
        shelves.forEach((shelf) => shelf.classList.add("yt-yf-hidden-by-year"));
      }

      let hiddenCount = 0;
      let shownCount = 0;

      videoRenderers.forEach((el) => {
        const metaBlock = el.querySelector(
          "#metadata-line, .yt-content-metadata-view-model, #metadata"
        );
        const titleEl = el.querySelector(
          "#video-title, .yt-lockup-metadata-view-model__title, h3"
        );
        const metaText = metaBlock ? metaBlock.textContent : el.textContent || "";
        const titleText = titleEl ? titleEl.textContent : "";

        if (!metaText) return;

        if (matchesTargetYears(metaText, titleText, state.years)) {
          el.classList.remove("yt-yf-hidden-by-year");
          shownCount++;
        } else {
          el.classList.add("yt-yf-hidden-by-year");
          hiddenCount++;
        }
      });

      updateStatusCounters(hiddenCount, shownCount);
    } finally {
      isUpdatingDOM = false;
    }
  }

  function updateStatusCounters(hiddenCount, shownCount) {
    const yearsText = formatYearsCompact(state.years);
    const nextText =
      !state.enabled || !state.years.length
        ? "All years shown"
        : `${yearsText} · ${shownCount} shown${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}`;

    const statusEl = document.getElementById("yt-yf-status-text");
    if (statusEl && statusEl.textContent !== nextText) {
      statusEl.textContent = nextText;
    }

    const sidebarStatusEl = document.getElementById("yt-yf-sidebar-status");
    if (sidebarStatusEl) {
      const sbText =
        !state.enabled || !state.years.length
          ? "Off"
          : `${yearsText}${hiddenCount > 0 ? ` · ${shownCount} matched` : ""}`;
      if (sidebarStatusEl.textContent !== sbText) {
        sidebarStatusEl.textContent = sbText;
      }
    }
  }

  function buildAllYearsButtonsHtml(className) {
    let html = "";
    for (let y = MIN_YEAR; y <= CURRENT_YEAR; y++) {
      html += `<button type="button" class="${className}" data-year="${y}" title="Select ${y}">${y}</button>`;
    }
    return html;
  }

  // Inject the main filter bar on /results with all years 2005-2026 in one unified list
  function injectFilterBar() {
    if (window.location.pathname !== "/results") return;
    if (document.getElementById("yt-year-filter-bar")) {
      updateAllUI();
      return;
    }

    const targetContainer = document.querySelector("ytd-search #primary");
    if (!targetContainer) return;

    isUpdatingDOM = true;
    try {
      const bar = document.createElement("div");
      bar.id = "yt-year-filter-bar";

      const allYearsHtml = buildAllYearsButtonsHtml("yt-yf-chip");

      bar.innerHTML = `
        <div class="yt-yf-top-row">
          <div class="yt-yf-brand">
            <span class="yt-yf-dot" id="yt-yf-dot"></span>
            <span>⏳ old-tube</span>
          </div>

          <div class="yt-yf-actions">
            <button type="button" class="yt-yf-apply" id="yt-yf-apply-btn">Apply Year</button>
            <button type="button" class="yt-yf-clear" id="yt-yf-clear-btn">Reset</button>
          </div>

          <div class="yt-yf-right-controls">
            <label class="yt-yf-strict-label" title="Hide Shorts shelves and videos outside your selected years">
              <input type="checkbox" id="yt-yf-strict-toggle" ${state.strictFilter ? "checked" : ""} />
              <span>Strict</span>
            </label>
            <div class="yt-yf-status">
              <span id="yt-yf-status-text">All years shown</span>
            </div>
          </div>
        </div>

        <div class="yt-yf-all-years">
          ${allYearsHtml}
        </div>
      `;

      targetContainer.prepend(bar);

      document.getElementById("yt-yf-apply-btn").addEventListener("click", () => {
        applyYearsToSearch(state.draftYears, state.draftYears.length > 0);
      });

      document.getElementById("yt-yf-clear-btn").addEventListener("click", () => {
        state.draftYears = [];
        applyYearsToSearch([], false);
      });

      document.getElementById("yt-yf-strict-toggle").addEventListener("change", (e) => {
        state.strictFilter = e.target.checked;
        browser.storage.local.set({ strictFilter: state.strictFilter });
        scheduleFilter(true);
      });

      bar.querySelectorAll(".yt-yf-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          toggleDraftYear(chip.getAttribute("data-year"));
        });
      });

      updateAllUI();
    } finally {
      isUpdatingDOM = false;
    }
  }

  // Inject the compact widget at the top of the video sidebar feed (#secondary / #related)
  function injectSidebarWidget() {
    const existing = document.getElementById("yt-year-sidebar-widget");
    if (!state.showSidebarWidget || window.location.pathname !== "/watch") {
      if (existing) existing.remove();
      return;
    }

    if (existing) {
      updateAllUI();
      return;
    }

    const sidebarTarget =
      document.querySelector("ytd-watch-flexy #secondary-inner") ||
      document.querySelector("ytd-watch-flexy #secondary") ||
      document.querySelector("#related");

    if (!sidebarTarget) return;

    isUpdatingDOM = true;
    try {
      const widget = document.createElement("div");
      widget.id = "yt-year-sidebar-widget";

      const allYearsHtml = buildAllYearsButtonsHtml("yt-yf-sb-chip");

      widget.innerHTML = `
        <div class="yt-yf-sb-header">
          <div class="yt-yf-sb-title">
            <span class="yt-yf-dot" id="yt-yf-sb-dot"></span>
            <span>⏳ old-tube</span>
          </div>
          <span class="yt-yf-sb-badge" id="yt-yf-sidebar-status">Off</span>
          <button type="button" class="yt-yf-sb-apply" id="yt-yf-sb-apply-btn">Apply</button>
          <button type="button" class="yt-yf-sb-reset" id="yt-yf-sb-reset-btn">Reset</button>
        </div>
        <div class="yt-yf-sb-chips">
          ${allYearsHtml}
        </div>
        <div class="yt-yf-sb-footer" id="yt-yf-sb-footer" style="display: none;">
          <button type="button" class="yt-yf-sb-search-btn" id="yt-yf-sb-search-btn">
            🔍 Search this video's topic in selected years
          </button>
        </div>
      `;

      sidebarTarget.prepend(widget);

      widget.querySelectorAll(".yt-yf-sb-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          toggleDraftYear(chip.getAttribute("data-year"));
        });
      });

      const sbApply = document.getElementById("yt-yf-sb-apply-btn");
      if (sbApply) {
        sbApply.addEventListener("click", () => {
          applyYearsToSearch(state.draftYears, state.draftYears.length > 0);
        });
      }

      const sbReset = document.getElementById("yt-yf-sb-reset-btn");
      if (sbReset) {
        sbReset.addEventListener("click", () => {
          state.draftYears = [];
          applyYearsToSearch([], false);
        });
      }

      const sbSearchBtn = document.getElementById("yt-yf-sb-search-btn");
      if (sbSearchBtn) {
        sbSearchBtn.addEventListener("click", () => {
          const targetYears = state.draftYears.length ? state.draftYears : state.years;
          if (!targetYears.length) return;
          state.years = normalizeYears(targetYears);
          state.draftYears = [...state.years];
          state.enabled = true;
          browser.storage.local.set({
            enabled: true,
            years: state.years,
            year: state.years[0] || ""
          });

          const videoTitleEl = document.querySelector(
            "ytd-watch-metadata h1 yt-formatted-string, #above-the-fold #title h1, h1.title"
          );
          const rawTitle = videoTitleEl
            ? videoTitleEl.textContent.trim()
            : document.title.replace(/ - YouTube$/i, "").trim();
          const cleanTopic = stripDateOperators(rawTitle)
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 6)
            .join(" ");
          if (!cleanTopic) return;
          const searchUrl = new URL("https://www.youtube.com/results");
          searchUrl.searchParams.set("search_query", buildYearQuery(cleanTopic, state.years));
          searchUrl.searchParams.set("yt_year", state.years.join(","));
          window.location.href = searchUrl.toString();
        });
      }

      updateAllUI();
    } finally {
      isUpdatingDOM = false;
    }
  }

  function updateAllUI() {
    cleanSearchBarAndTitle();

    const isActive = state.enabled && state.years.length > 0;
    const draftCount = state.draftYears.length;

    // 1. Update Search Results Bar (#yt-year-filter-bar)
    const bar = document.getElementById("yt-year-filter-bar");
    if (bar) {
      const dot = document.getElementById("yt-yf-dot");
      const applyBtn = document.getElementById("yt-yf-apply-btn");
      const strictToggle = document.getElementById("yt-yf-strict-toggle");
      const chips = bar.querySelectorAll(".yt-yf-chip");

      if (dot) dot.classList.toggle("active", isActive);
      if (strictToggle && strictToggle.checked !== state.strictFilter) {
        strictToggle.checked = state.strictFilter;
      }
      if (applyBtn) {
        applyBtn.textContent =
          draftCount > 1
            ? `Apply Years (${draftCount})`
            : draftCount === 1
            ? `Apply ${state.draftYears[0]}`
            : "Apply Year";
      }

      chips.forEach((chip) => {
        const y = chip.getAttribute("data-year");
        chip.classList.toggle("active", state.draftYears.includes(y));
      });
    }

    // 2. Update Video Sidebar Feed Widget (#yt-year-sidebar-widget)
    const widget = document.getElementById("yt-year-sidebar-widget");
    if (widget) {
      const sbDot = document.getElementById("yt-yf-sb-dot");
      const sbApply = document.getElementById("yt-yf-sb-apply-btn");
      const sbFooter = document.getElementById("yt-yf-sb-footer");
      const sbSearchBtn = document.getElementById("yt-yf-sb-search-btn");
      const sbChips = widget.querySelectorAll(".yt-yf-sb-chip");

      if (sbDot) sbDot.classList.toggle("active", isActive);
      if (sbApply) {
        sbApply.textContent = draftCount > 0 ? `Apply (${draftCount})` : "Apply";
      }
      const activeOrDraft = state.draftYears.length ? state.draftYears : state.years;
      if (sbFooter) sbFooter.style.display = activeOrDraft.length > 0 ? "block" : "none";
      if (sbSearchBtn && activeOrDraft.length > 0) {
        sbSearchBtn.textContent = `🔍 Search related videos in ${formatYearsCompact(activeOrDraft)}`;
      }

      sbChips.forEach((chip) => {
        const y = chip.getAttribute("data-year");
        chip.classList.toggle("active", state.draftYears.includes(y));
      });
    }
  }

  function syncStateAndRun() {
    const url = new URL(window.location.href);

    browser.storage.local
      .get(["enabled", "years", "year", "strictFilter", "showSidebarWidget"])
      .then((stored) => {
        if (stored.strictFilter !== undefined) {
          state.strictFilter = stored.strictFilter;
        }
        if (stored.showSidebarWidget !== undefined) {
          state.showSidebarWidget = stored.showSidebarWidget;
        }

        const storedYears = normalizeYears(stored.years || (stored.year ? [stored.year] : []));
        const urlYears = detectYearsFromUrl(url, storedYears);

        if (urlYears && urlYears.length) {
          state.years = urlYears;
          state.draftYears = [...urlYears];
          state.enabled = true;
          browser.storage.local.set({
            enabled: true,
            years: urlYears,
            year: urlYears[0] || ""
          });
        } else {
          state.enabled = Boolean(stored.enabled && storedYears.length);
          state.years = state.enabled ? storedYears : [];
          state.draftYears = [...state.years];
        }

        cleanSearchBarAndTitle();
        injectFilterBar();
        injectSidebarWidget();
        scheduleFilter(true);
      });
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "APPLY_YEAR_FILTER") {
      if (msg.strictFilter !== undefined) state.strictFilter = msg.strictFilter;
      if (msg.showSidebarWidget !== undefined) state.showSidebarWidget = msg.showSidebarWidget;
      const incomingYears = msg.years || (msg.year ? [msg.year] : []);
      injectSidebarWidget();
      applyYearsToSearch(incomingYears, msg.enabled);
    }
  });

  window.addEventListener("yt-navigate-finish", () => {
    cleanSearchBarAndTitle();
    setTimeout(syncStateAndRun, 150);
  });

  setInterval(() => {
    if (window.location.pathname === "/results") {
      cleanSearchBarAndTitle();
      if (!document.getElementById("yt-year-filter-bar")) {
        injectFilterBar();
      }
      if (state.enabled && state.years.length && state.strictFilter) {
        runStrictDOMFilter();
      }
    } else if (window.location.pathname === "/watch") {
      injectSidebarWidget();
      if (state.enabled && state.years.length && state.strictFilter) {
        runStrictDOMFilter();
      }
    }
  }, 800);

  setupSearchInterceptors();
  syncStateAndRun();
})();
