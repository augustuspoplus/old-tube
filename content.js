(function () {
  const CURRENT_YEAR = new Date().getFullYear();
  const MIN_YEAR = 2005;

  let state = {
    enabled: false,
    year: "",
    strictFilter: true
  };

  let isUpdatingDOM = false;
  let filterTimeout = null;

  // Strip existing before:YYYY... and after:YYYY... operators from a search query
  function stripDateOperators(query) {
    if (!query) return "";
    return query
      .replace(/\b(before|after):\d{4}(-\d{2}(-\d{2})?)?\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Extract year from query if before:/after: operators are already present
  function detectYearFromQuery(query) {
    if (!query) return null;
    const afterMatch = query.match(/\bafter:(\d{4})-12-31\b/i);
    const beforeMatch = query.match(/\bbefore:(\d{4})-01-01\b/i);
    if (afterMatch && beforeMatch) {
      const yAfter = parseInt(afterMatch[1], 10) + 1;
      const yBefore = parseInt(beforeMatch[1], 10) - 1;
      if (yAfter === yBefore) return String(yAfter);
    }
    const afterJan = query.match(/\bafter:(\d{4})-01-01\b/i);
    const beforeDec = query.match(/\bbefore:(\d{4})-12-31\b/i);
    if (afterJan && beforeDec && afterJan[1] === beforeDec[1]) {
      return afterJan[1];
    }
    return null;
  }

  // Build search query with YouTube's date operators
  function buildYearQuery(rawQuery, year) {
    const clean = stripDateOperators(rawQuery);
    if (!year) return clean;
    const y = parseInt(year, 10);
    if (isNaN(y)) return clean;
    return `${clean} after:${y - 1}-12-31 before:${y + 1}-01-01`.trim();
  }

  // Keep the YouTube search bar & tab title completely clean of ugly before:/after: operators
  function cleanSearchBarAndTitle() {
    // 1. Clean all YouTube search inputs on the page
    const inputs = document.querySelectorAll(
      'input#search, input[name="search_query"], input.ytSearchboxComponentInput'
    );
    inputs.forEach((input) => {
      if (document.activeElement === input) return; // Don't interrupt while the user is actively typing
      if (input.value && /\b(before|after):\d{4}/i.test(input.value)) {
        input.value = stripDateOperators(input.value);
      }
    });

    // 2. Clean the browser tab title (e.g., "minecraft after:2012-12-31... - YouTube" -> "minecraft (2013) - YouTube")
    if (/\b(before|after):\d{4}/i.test(document.title)) {
      const cleanedTitle = stripDateOperators(document.title);
      document.title = state.enabled && state.year
        ? cleanedTitle.replace(/ - YouTube$/i, ` (${state.year}) - YouTube`)
        : cleanedTitle;
    }

    // 3. Clean the visible URL in the browser address bar without triggering a page reload
    if (window.location.pathname === "/results") {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("search_query") || "";
      if (/\b(before|after):\d{4}/i.test(q)) {
        const cleanQ = stripDateOperators(q);
        url.searchParams.set("search_query", cleanQ);
        if (state.enabled && state.year) {
          url.searchParams.set("yt_year", state.year);
        }
        window.history.replaceState(window.history.state, "", url.toString());
      }
    }
  }

  // Navigate to updated YouTube search URL with the year operators applied
  function applyYearToSearch(year, forceEnable = true) {
    const url = new URL(window.location.href);
    const currentQ = url.searchParams.get("search_query") || "";
    const cleanQ = stripDateOperators(currentQ);

    state.year = year ? String(year) : "";
    state.enabled = Boolean(year) && forceEnable;

    browser.storage.local.set({
      enabled: state.enabled,
      year: state.year,
      strictFilter: state.strictFilter
    });

    if (window.location.pathname === "/results" && cleanQ) {
      const newQuery = state.enabled && state.year ? buildYearQuery(cleanQ, state.year) : cleanQ;
      url.searchParams.delete("yt_year");
      url.searchParams.set("search_query", newQuery);
      window.location.href = url.toString();
      return;
    }

    updateBarUI();
    scheduleFilter(true);
  }

  // Intercept new searches when a year filter is active so YouTube searches with the year operator
  // while immediately restoring the visible text in the input box!
  function setupSearchInterceptors() {
    // When user presses Enter inside the search input
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || !state.enabled || !state.year) return;
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
          searchUrl.searchParams.set("search_query", buildYearQuery(cleanVal, state.year));
          window.location.href = searchUrl.toString();
        }
      },
      true
    );

    // When user clicks the magnifying glass search button
    document.addEventListener(
      "click",
      (e) => {
        if (!state.enabled || !state.year) return;
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
          searchUrl.searchParams.set("search_query", buildYearQuery(cleanVal, state.year));
          window.location.href = searchUrl.toString();
        }
      },
      true
    );
  }

  // Fast check using textContent (does not trigger browser reflow)
  function matchesTargetYear(metadataText, titleText, targetYear) {
    const target = parseInt(targetYear, 10);
    if (isNaN(target)) return true;

    const combined = `${metadataText} ${titleText}`;

    const yearsAgoMatch = combined.match(/(\d+)\s+years?\s+ago/i);
    if (yearsAgoMatch) {
      const yearsAgo = parseInt(yearsAgoMatch[1], 10);
      const estimatedYear = CURRENT_YEAR - yearsAgo;
      return Math.abs(estimatedYear - target) <= 1;
    }

    if (/\b(\d+)\s+(months?|weeks?|days?|hours?|minutes?|seconds?)\s+ago\b/i.test(combined)) {
      return target === CURRENT_YEAR || target === CURRENT_YEAR - 1;
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

      if (!state.enabled || !state.year || !state.strictFilter) {
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

      if (parseInt(state.year, 10) < CURRENT_YEAR) {
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

        if (matchesTargetYear(metaText, titleText, state.year)) {
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

    const nextText =
      !state.enabled || !state.year
        ? "All years shown"
        : `Showing ${state.year} (${shownCount} matched${
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

      let yearOptions = `<option value="">Any Year</option>`;
      for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
        yearOptions += `<option value="${y}">${y}</option>`;
      }

      const nostalgicYears = [2007, 2010, 2012, 2013, 2014, 2015, 2016, 2018, 2020];
      const quickChipsHtml = nostalgicYears
        .map((y) => `<span class="yt-yf-chip" data-year="${y}">${y}</span>`)
        .join("");

      bar.innerHTML = `
        <div class="yt-yf-title">
          <span>⏳ Year Filter:</span>
        </div>
        <select id="yt-yf-select" title="Select Year">
          ${yearOptions}
        </select>
        <div class="yt-yf-QuickYears">
          ${quickChipsHtml}
        </div>
        <label class="yt-yf-strict-label" title="Hide Shorts shelves and stray recommendations that don't match the selected year">
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
        applyYearToSearch(selectedYear, Boolean(selectedYear));
      });

      document.getElementById("yt-yf-strict-toggle").addEventListener("change", (e) => {
        state.strictFilter = e.target.checked;
        browser.storage.local.set({ strictFilter: state.strictFilter });
        scheduleFilter(true);
      });

      document.getElementById("yt-yf-clear-btn").addEventListener("click", () => {
        applyYearToSearch("", false);
      });

      bar.querySelectorAll(".yt-yf-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          const y = chip.getAttribute("data-year");
          applyYearToSearch(y, true);
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

    const activeYear = state.enabled ? state.year : "";
    if (selectEl.value !== activeYear) selectEl.value = activeYear;
    if (strictToggle && strictToggle.checked !== state.strictFilter) {
      strictToggle.checked = state.strictFilter;
    }
    if (clearBtn) {
      const targetDisplay = activeYear ? "inline-block" : "none";
      if (clearBtn.style.display !== targetDisplay) {
        clearBtn.style.display = targetDisplay;
      }
    }

    chips.forEach((chip) => {
      const isMatch = chip.getAttribute("data-year") === activeYear;
      chip.classList.toggle("active", isMatch);
    });
  }

  function syncStateAndRun() {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("search_query") || "";
    const urlYear = detectYearFromQuery(q) || url.searchParams.get("yt_year");

    browser.storage.local.get(["enabled", "year", "strictFilter"]).then((stored) => {
      if (stored.strictFilter !== undefined) {
        state.strictFilter = stored.strictFilter;
      }

      if (urlYear) {
        state.year = urlYear;
        state.enabled = true;
        browser.storage.local.set({ enabled: true, year: urlYear });
      } else {
        state.enabled = Boolean(stored.enabled);
        state.year = stored.year || "";
      }

      cleanSearchBarAndTitle();
      injectFilterBar();
      scheduleFilter(true);
    });
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "APPLY_YEAR_FILTER") {
      state.strictFilter = msg.strictFilter !== undefined ? msg.strictFilter : state.strictFilter;
      applyYearToSearch(msg.year, msg.enabled);
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
      if (state.enabled && state.year && state.strictFilter) {
        runStrictDOMFilter();
      }
    }
  }, 800);

  setupSearchInterceptors();
  syncStateAndRun();
})();
