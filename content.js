(function () {
  const CURRENT_YEAR = new Date().getFullYear();
  const MIN_YEAR = 2005;
  const QUICK_YEARS = [2007, 2009, 2011, 2012, 2013, 2014, 2015, 2016, 2018, 2020];

  let state = {
    enabled: false,
    years: [], // Array of selected year strings, e.g. ["2012", "2014"]
    strictFilter: true,
    showSidebarWidget: true,
    trayOpen: false
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

      // Preserve exact non-contiguous selection when min/max bounds match stored selection
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

  // Immediately save and apply the selected years
  function applyYearsToSearch(yearsInput, forceEnable = true) {
    const url = new URL(window.location.href);
    const currentQ = url.searchParams.get("search_query") || "";
    const cleanQ = stripDateOperators(currentQ);

    const normalized = normalizeYears(yearsInput);
    state.years = normalized;
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

  // Toggle a single year in the active selection and immediately apply
  function toggleYearAndApply(yearStr) {
    const y = String(yearStr);
    const nextYears = state.years.includes(y)
      ? state.years.filter((item) => item !== y)
      : normalizeYears([...state.years, y]);
    applyYearsToSearch(nextYears, nextYears.length > 0);
  }

  // Toggle a span of years and immediately apply
  function toggleRangeAndApply(startYear, endYear) {
    const a = parseInt(startYear, 10);
    const b = parseInt(endYear, 10);
    if (isNaN(a) || isNaN(b)) return;
    const min = Math.max(MIN_YEAR, Math.min(a, b));
    const max = Math.min(CURRENT_YEAR, Math.max(a, b));
    const range = [];
    for (let y = min; y <= max; y++) range.push(String(y));

    const allPresent = range.every((y) => state.years.includes(y));
    const nextYears = allPresent
      ? state.years.filter((y) => !range.includes(y))
      : normalizeYears([...state.years, ...range]);
    applyYearsToSearch(nextYears, nextYears.length > 0);
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

  // Inject the main filter bar on /results
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

      let allYearsChipsHtml = "";
      let rangeOptionsHtml = "";
      for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
        allYearsChipsHtml += `<button type="button" class="yt-yf-grid-chip" data-year="${y}" title="Click to toggle ${y}">${y}</button>`;
        rangeOptionsHtml += `<option value="${y}">${y}</option>`;
      }

      const quickChipsHtml = QUICK_YEARS.map(
        (y) =>
          `<button type="button" class="yt-yf-chip" data-year="${y}" title="Click to toggle ${y}">${y}</button>`
      ).join("");

      bar.innerHTML = `
        <div class="yt-yf-main-row">
          <div class="yt-yf-brand">
            <span class="yt-yf-dot" id="yt-yf-dot"></span>
            <span>⏳ old-tube</span>
          </div>

          <div class="yt-yf-active-tags" id="yt-yf-active-tags"></div>

          <div class="yt-yf-QuickYears">
            ${quickChipsHtml}
          </div>

          <button type="button" class="yt-yf-tray-btn" id="yt-yf-tray-toggle" title="Pick from all years (2005 – Present)">
            <span>📅 All Years</span>
            <span class="yt-yf-chevron" id="yt-yf-chevron">▾</span>
          </button>

          <button type="button" class="yt-yf-clear" id="yt-yf-clear-btn" style="display: none;">
            Reset
          </button>

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

        <div class="yt-yf-tray" id="yt-yf-tray" style="display: none;">
          <div class="yt-yf-tray-header">
            <span class="yt-yf-tray-label">Select any years (2005 – ${CURRENT_YEAR}):</span>
            <div class="yt-yf-range-picker">
              <span class="yt-yf-tray-label">Range:</span>
              <select id="yt-yf-range-from">${rangeOptionsHtml}</select>
              <span>–</span>
              <select id="yt-yf-range-to">${rangeOptionsHtml}</select>
              <button type="button" class="yt-yf-range-add" id="yt-yf-range-add-btn">+ Toggle Range</button>
            </div>
          </div>
          <div class="yt-yf-grid">
            ${allYearsChipsHtml}
          </div>
        </div>
      `;

      targetContainer.prepend(bar);

      const fromSelect = document.getElementById("yt-yf-range-from");
      const toSelect = document.getElementById("yt-yf-range-to");
      if (fromSelect && toSelect) {
        fromSelect.value = "2010";
        toSelect.value = "2014";
      }

      document.getElementById("yt-yf-tray-toggle").addEventListener("click", () => {
        state.trayOpen = !state.trayOpen;
        updateAllUI();
      });

      document.getElementById("yt-yf-clear-btn").addEventListener("click", () => {
        applyYearsToSearch([], false);
      });

      document.getElementById("yt-yf-strict-toggle").addEventListener("change", (e) => {
        state.strictFilter = e.target.checked;
        browser.storage.local.set({ strictFilter: state.strictFilter });
        scheduleFilter(true);
      });

      document.getElementById("yt-yf-range-add-btn").addEventListener("click", () => {
        toggleRangeAndApply(fromSelect.value, toSelect.value);
      });

      bar.querySelectorAll(".yt-yf-chip, .yt-yf-grid-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const y = chip.getAttribute("data-year");
          toggleYearAndApply(y);
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

      let yearSelectOptions = `<option value="">+ Year...</option>`;
      for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
        yearSelectOptions += `<option value="${y}">${y}</option>`;
      }

      const quickChipsHtml = QUICK_YEARS.map(
        (y) =>
          `<button type="button" class="yt-yf-sb-chip" data-year="${y}" title="Toggle ${y}">${y}</button>`
      ).join("");

      widget.innerHTML = `
        <div class="yt-yf-sb-header">
          <div class="yt-yf-sb-title">
            <span class="yt-yf-dot" id="yt-yf-sb-dot"></span>
            <span>⏳ old-tube</span>
          </div>
          <span class="yt-yf-sb-badge" id="yt-yf-sidebar-status">Off</span>
          <button type="button" class="yt-yf-sb-reset" id="yt-yf-sb-reset-btn" style="display: none;">Reset</button>
        </div>
        <div class="yt-yf-sb-active-tags" id="yt-yf-sb-active-tags"></div>
        <div class="yt-yf-sb-chips">
          ${quickChipsHtml}
          <select id="yt-yf-sb-select" class="yt-yf-sb-select" title="Add or remove any year (2005 – Present)">
            ${yearSelectOptions}
          </select>
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
          toggleYearAndApply(chip.getAttribute("data-year"));
        });
      });

      const sbSelect = document.getElementById("yt-yf-sb-select");
      if (sbSelect) {
        sbSelect.addEventListener("change", () => {
          const val = sbSelect.value;
          sbSelect.value = "";
          if (val) toggleYearAndApply(val);
        });
      }

      const sbReset = document.getElementById("yt-yf-sb-reset-btn");
      if (sbReset) {
        sbReset.addEventListener("click", () => {
          applyYearsToSearch([], false);
        });
      }

      const sbSearchBtn = document.getElementById("yt-yf-sb-search-btn");
      if (sbSearchBtn) {
        sbSearchBtn.addEventListener("click", () => {
          if (!state.years.length) return;
          const videoTitleEl = document.querySelector(
            "ytd-watch-metadata h1 yt-formatted-string, #above-the-fold #title h1, h1.title"
          );
          const rawTitle = videoTitleEl
            ? videoTitleEl.textContent.trim()
            : document.title.replace(/ - YouTube$/i, "").trim();
          // Use first 6 words of current video title for a clean related search
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

  function renderRemovableTags(container) {
    if (!container) return;
    if (!state.enabled || !state.years.length) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = state.years
      .map(
        (y) =>
          `<span class="yt-yf-tag committed" data-year="${y}" title="Click × to remove ${y}">${y} <button type="button" class="yt-yf-tag-remove" data-year="${y}">×</button></span>`
      )
      .join("");

    container.querySelectorAll(".yt-yf-tag-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const y = btn.getAttribute("data-year");
        const nextYears = state.years.filter((item) => item !== y);
        applyYearsToSearch(nextYears, nextYears.length > 0);
      });
    });
  }

  function updateAllUI() {
    cleanSearchBarAndTitle();

    const isActive = state.enabled && state.years.length > 0;

    // 1. Update Search Results Bar (#yt-year-filter-bar)
    const bar = document.getElementById("yt-year-filter-bar");
    if (bar) {
      const dot = document.getElementById("yt-yf-dot");
      const activeTagsContainer = document.getElementById("yt-yf-active-tags");
      const clearBtn = document.getElementById("yt-yf-clear-btn");
      const strictToggle = document.getElementById("yt-yf-strict-toggle");
      const trayEl = document.getElementById("yt-yf-tray");
      const trayBtn = document.getElementById("yt-yf-tray-toggle");
      const chevron = document.getElementById("yt-yf-chevron");
      const chips = bar.querySelectorAll(".yt-yf-chip, .yt-yf-grid-chip");

      if (dot) dot.classList.toggle("active", isActive);
      if (strictToggle && strictToggle.checked !== state.strictFilter) {
        strictToggle.checked = state.strictFilter;
      }
      if (trayEl && trayBtn && chevron) {
        trayEl.style.display = state.trayOpen ? "flex" : "none";
        trayBtn.classList.toggle("open", state.trayOpen);
        chevron.textContent = state.trayOpen ? "▴" : "▾";
      }
      if (clearBtn) {
        clearBtn.style.display = isActive ? "inline-flex" : "none";
      }

      renderRemovableTags(activeTagsContainer);

      chips.forEach((chip) => {
        const y = chip.getAttribute("data-year");
        chip.classList.toggle("active", isActive && state.years.includes(y));
      });
    }

    // 2. Update Video Sidebar Feed Widget (#yt-year-sidebar-widget)
    const widget = document.getElementById("yt-year-sidebar-widget");
    if (widget) {
      const sbDot = document.getElementById("yt-yf-sb-dot");
      const sbReset = document.getElementById("yt-yf-sb-reset-btn");
      const sbTags = document.getElementById("yt-yf-sb-active-tags");
      const sbFooter = document.getElementById("yt-yf-sb-footer");
      const sbSearchBtn = document.getElementById("yt-yf-sb-search-btn");
      const sbChips = widget.querySelectorAll(".yt-yf-sb-chip");

      if (sbDot) sbDot.classList.toggle("active", isActive);
      if (sbReset) sbReset.style.display = isActive ? "inline-flex" : "none";
      if (sbFooter) sbFooter.style.display = isActive ? "block" : "none";
      if (sbSearchBtn && isActive) {
        sbSearchBtn.textContent = `🔍 Search related videos in ${formatYearsCompact(state.years)}`;
      }

      renderRemovableTags(sbTags);

      sbChips.forEach((chip) => {
        const y = chip.getAttribute("data-year");
        chip.classList.toggle("active", isActive && state.years.includes(y));
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
          state.enabled = true;
          browser.storage.local.set({
            enabled: true,
            years: urlYears,
            year: urlYears[0] || ""
          });
        } else {
          state.enabled = Boolean(stored.enabled && storedYears.length);
          state.years = state.enabled ? storedYears : [];
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
