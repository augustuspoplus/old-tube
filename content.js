(function () {
  const CURRENT_YEAR = new Date().getFullYear();
  const MIN_YEAR = 2005;

  let state = {
    enabled: false,
    years: [], // Array of selected year strings, e.g. ["2013", "2014"]
    strictFilter: true
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

  // Strip existing before:YYYY... and after:YYYY... operators from a search query
  function stripDateOperators(query) {
    if (!query) return "";
    return query
      .replace(/\b(before|after):\d{4}(-\d{2}(-\d{2})?)?\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Extract years from URL or query if before:/after: operators are already present
  function detectYearsFromUrl(url) {
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
      if (minY === maxY) return [String(minY)];
      if (minY < maxY && maxY - minY <= 25) {
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

    const yearsLabel = state.years.join(", ");
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
        }
        window.history.replaceState(window.history.state, "", url.toString());
      }
    }
  }

  // Navigate to updated YouTube search URL with the year operators applied
  function applyYearsToSearch(yearsInput, forceEnable = true) {
    const url = new URL(window.location.href);
    const currentQ = url.searchParams.get("search_query") || "";
    const cleanQ = stripDateOperators(currentQ);

    state.years = normalizeYears(yearsInput);
    state.enabled = state.years.length > 0 && forceEnable;

    browser.storage.local.set({
      enabled: state.enabled,
      years: state.years,
      year: state.years[0] || "",
      strictFilter: state.strictFilter
    });

    if (window.location.pathname === "/results" && cleanQ) {
      const newQuery =
        state.enabled && state.years.length ? buildYearQuery(cleanQ, state.years) : cleanQ;
      url.searchParams.delete("yt_year");
      url.searchParams.set("search_query", newQuery);
      window.location.href = url.toString();
      return;
    }

    updateBarUI();
    scheduleFilter(true);
  }

  function toggleYearSelection(yearStr) {
    const y = String(yearStr);
    const nextYears = state.years.includes(y)
      ? state.years.filter((item) => item !== y)
      : [...state.years, y];
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
    if (window.location.pathname !== "/results" || isUpdatingDOM) return;
    isUpdatingDOM = true;

    try {
      cleanSearchBarAndTitle();

      const videoRenderers = document.querySelectorAll("ytd-video-renderer");
      const shelves = document.querySelectorAll(
        "ytd-reel-shelf-renderer, ytd-shelf-renderer, ytd-horizontal-card-list-renderer"
      );

      if (!state.enabled || !state.years.length || !state.strictFilter) {
        videoRenderers.forEach((el) => {
          if (el.classList.contains("yt-yf-hidden-by-year")) {
            el.classList.remove("yt-yf-hidden-by-year");
          }
        });
        shelves.forEach((el) => {
          if (el.classList.contains("yt-yf-hidden-by-year")) {
            el.classList.remove("yt-yf-hidden-by-year");
          }
        });
        updateStatusCounter(0, videoRenderers.length);
        return;
      }

      const maxSelectedYear = Math.max(...state.years.map((y) => parseInt(y, 10)));
      if (maxSelectedYear < CURRENT_YEAR) {
        shelves.forEach((shelf) => {
          if (!shelf.classList.contains("yt-yf-hidden-by-year")) {
            shelf.classList.add("yt-yf-hidden-by-year");
          }
        });
      }

      let hiddenCount = 0;
      let shownCount = 0;

      videoRenderers.forEach((el) => {
        const metaBlock = el.querySelector("#metadata-line");
        const titleEl = el.querySelector("#video-title");
        const metaText = metaBlock ? metaBlock.textContent : "";
        const titleText = titleEl ? titleEl.textContent : "";

        if (!metaText) return;

        if (matchesTargetYears(metaText, titleText, state.years)) {
          if (el.classList.contains("yt-yf-hidden-by-year")) {
            el.classList.remove("yt-yf-hidden-by-year");
          }
          shownCount++;
        } else {
          if (!el.classList.contains("yt-yf-hidden-by-year")) {
            el.classList.add("yt-yf-hidden-by-year");
          }
          hiddenCount++;
        }
      });

      updateStatusCounter(hiddenCount, shownCount);
    } finally {
      isUpdatingDOM = false;
    }
  }

  function updateStatusCounter(hiddenCount, shownCount) {
    const statusEl = document.getElementById("yt-yf-status-text");
    if (!statusEl) return;

    const yearsText = state.years.join(", ");
    const nextText =
      !state.enabled || !state.years.length
        ? "All years shown"
        : `Showing ${yearsText} (${shownCount} matched${
            hiddenCount > 0 ? `, ${hiddenCount} hidden` : ""
          })`;

    if (statusEl.textContent !== nextText) {
      statusEl.textContent = nextText;
    }
  }

  function injectFilterBar() {
    if (window.location.pathname !== "/results") return;
    if (document.getElementById("yt-year-filter-bar")) {
      updateBarUI();
      return;
    }

    const targetContainer = document.querySelector("ytd-search #primary");
    if (!targetContainer) return;

    isUpdatingDOM = true;
    try {
      const bar = document.createElement("div");
      bar.id = "yt-year-filter-bar";

      let yearOptions = `<option value="">+ Add Year...</option>`;
      for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
        yearOptions += `<option value="${y}">${y}</option>`;
      }

      const nostalgicYears = [2007, 2010, 2012, 2013, 2014, 2015, 2016, 2018, 2020];
      const quickChipsHtml = nostalgicYears
        .map(
          (y) =>
            `<span class="yt-yf-chip" data-year="${y}" title="Click to toggle ${y}">${y}</span>`
        )
        .join("");

      bar.innerHTML = `
        <div class="yt-yf-title">
          <span>⏳ Year Filter:</span>
        </div>
        <select id="yt-yf-select" title="Add or Toggle a Year">
          ${yearOptions}
        </select>
        <div class="yt-yf-QuickYears">
          ${quickChipsHtml}
        </div>
        <label class="yt-yf-strict-label" title="Hide Shorts shelves and stray recommendations that don't match your selected years">
          <input type="checkbox" id="yt-yf-strict-toggle" ${state.strictFilter ? "checked" : ""} />
          Strict Mode
        </label>
        <button class="yt-yf-clear" id="yt-yf-clear-btn" style="display: none;">Reset</button>
        <div class="yt-yf-status">
          <span id="yt-yf-status-text">All years shown</span>
        </div>
      `;

      targetContainer.prepend(bar);

      document.getElementById("yt-yf-select").addEventListener("change", (e) => {
        const selectedYear = e.target.value;
        if (!selectedYear) return;
        toggleYearSelection(selectedYear);
      });

      document.getElementById("yt-yf-strict-toggle").addEventListener("change", (e) => {
        state.strictFilter = e.target.checked;
        browser.storage.local.set({ strictFilter: state.strictFilter });
        scheduleFilter(true);
      });

      document.getElementById("yt-yf-clear-btn").addEventListener("click", () => {
        applyYearsToSearch([], false);
      });

      bar.querySelectorAll(".yt-yf-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const y = chip.getAttribute("data-year");
          toggleYearSelection(y);
        });
      });

      updateBarUI();
    } finally {
      isUpdatingDOM = false;
    }
  }

  function updateBarUI() {
    const selectEl = document.getElementById("yt-yf-select");
    const clearBtn = document.getElementById("yt-yf-clear-btn");
    const strictToggle = document.getElementById("yt-yf-strict-toggle");
    const chips = document.querySelectorAll("#yt-year-filter-bar .yt-yf-chip");

    cleanSearchBarAndTitle();

    if (!selectEl) return;

    selectEl.value = "";
    if (strictToggle && strictToggle.checked !== state.strictFilter) {
      strictToggle.checked = state.strictFilter;
    }
    if (clearBtn) {
      const targetDisplay = state.enabled && state.years.length ? "inline-block" : "none";
      if (clearBtn.style.display !== targetDisplay) {
        clearBtn.style.display = targetDisplay;
      }
    }

    chips.forEach((chip) => {
      const y = chip.getAttribute("data-year");
      const isMatch = state.enabled && state.years.includes(y);
      chip.classList.toggle("active", isMatch);
    });
  }

  function syncStateAndRun() {
    const url = new URL(window.location.href);
    const urlYears = detectYearsFromUrl(url);

    browser.storage.local.get(["enabled", "years", "year", "strictFilter"]).then((stored) => {
      if (stored.strictFilter !== undefined) {
        state.strictFilter = stored.strictFilter;
      }

      if (urlYears && urlYears.length) {
        state.years = urlYears;
        state.enabled = true;
        browser.storage.local.set({
          enabled: true,
          years: urlYears,
          year: urlYears[0] || ""
        });
      } else {
        state.enabled = Boolean(stored.enabled);
        state.years = normalizeYears(stored.years || (stored.year ? [stored.year] : []));
      }

      cleanSearchBarAndTitle();
      injectFilterBar();
      scheduleFilter(true);
    });
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "APPLY_YEAR_FILTER") {
      state.strictFilter = msg.strictFilter !== undefined ? msg.strictFilter : state.strictFilter;
      const incomingYears = msg.years || (msg.year ? [msg.year] : []);
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
    }
  }, 800);

  setupSearchInterceptors();
  syncStateAndRun();
})();
