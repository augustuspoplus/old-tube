(function () {
  const CURRENT_YEAR = new Date().getFullYear();
  const MIN_YEAR = 2005;

  let state = {
    enabled: false,
    years: [],      // Committed active years, e.g. ["2008", "2009"]
    draftYears: [], // Highlighted years waiting for Apply
    strictFilter: true,
    showSidebarWidget: true
  };

  let isUpdatingDOM = false;
  let filterTimeout = null;
  let lastSidebarFetchKey = "";
  let isFetchingSidebar = false;
  let cachedSidebarVideos = [];
  let lastEndscreenSignature = "";

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

  function syncRootActiveAttribute() {
    const isActive = Boolean(state.enabled && state.years.length > 0);
    if (isActive) {
      document.documentElement.setAttribute("data-oldtube-active", "true");
    } else {
      document.documentElement.removeAttribute("data-oldtube-active");
    }
  }

  // Keep the YouTube search bar & tab title completely clean of ugly before:/after: operators
  function cleanSearchBarAndTitle() {
    syncRootActiveAttribute();

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
    syncRootActiveAttribute();

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

    lastSidebarFetchKey = "";
    cachedSidebarVideos = [];
    lastEndscreenSignature = "";
    updateAllUI();
    scheduleFilter(true);
    if (window.location.pathname === "/watch") {
      loadSidebarYearFeed(true);
    }
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
  // Supports both full ("12 years ago", "3 months ago") and short ("12y ago", "3mo ago", "5d ago") formats
  function matchesTargetYears(metadataText, titleText, targetYears) {
    const numericTargets = targetYears.map((y) => parseInt(y, 10)).filter((y) => !isNaN(y));
    if (!numericTargets.length) return true;

    const combined = `${metadataText || ""} ${titleText || ""}`;

    // Match "12 years ago", "12 yr ago", "12y ago"
    const yearsAgoMatch = combined.match(/\b(\d+)\s*(?:years?|yrs?|y)\s+ago\b/i);
    if (yearsAgoMatch) {
      const yearsAgo = parseInt(yearsAgoMatch[1], 10);
      const estimatedYear = CURRENT_YEAR - yearsAgo;
      return numericTargets.some((target) => Math.abs(estimatedYear - target) <= 1);
    }

    // Match sub-year recent uploads: "3 months ago", "3mo ago", "2 weeks ago", "2w ago", "4 days ago", "4d ago", "5 hours ago", "5h ago", "10 minutes ago", "10m ago"
    if (
      /\b(\d+)\s*(?:months?|mos?|mo|weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s+ago\b/i.test(
        combined
      )
    ) {
      return numericTargets.some(
        (target) => target === CURRENT_YEAR || target === CURRENT_YEAR - 1
      );
    }

    // If all selected years are older than last year, reject items with no recognizable "Xy ago" date (e.g. Live streams, Mixes, Promoted modern videos)
    const maxTarget = Math.max(...numericTargets);
    if (maxTarget < CURRENT_YEAR - 1) {
      return false;
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
    if (window.location.pathname !== "/results") return;

    isUpdatingDOM = true;

    try {
      cleanSearchBarAndTitle();

      const videoRenderers = document.querySelectorAll("ytd-video-renderer");
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
        const metaBlock = el.querySelector("#metadata-line");
        const titleEl = el.querySelector("#video-title");
        const metaText = metaBlock ? metaBlock.textContent : "";
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
  }

  function appendAllYearButtons(container, className) {
    for (let y = MIN_YEAR; y <= CURRENT_YEAR; y++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = className;
      btn.setAttribute("data-year", String(y));
      btn.title = `Select ${y}`;
      btn.textContent = String(y);
      btn.addEventListener("click", () => {
        toggleDraftYear(String(y));
      });
      container.appendChild(btn);
    }
  }

  // Extract current watch page video title/keywords for the sidebar year feed
  function getCurrentWatchKeywords() {
    const titleEl = document.querySelector(
      "ytd-watch-metadata h1 yt-formatted-string, #above-the-fold #title h1, h1.title"
    );
    const rawTitle = titleEl
      ? titleEl.textContent.trim()
      : document.title
          .replace(/^\(\d+\)\s*/, "")
          .replace(/\s*-\s*YouTube$/i, "")
          .trim();

    const stopWords = new Set([
      "the", "and", "for", "with", "from", "that", "this", "what", "when", "where",
      "who", "why", "how", "official", "video", "music", "audio", "full", "episode",
      "part", "hq", "hd", "4k", "1080p", "720p", "lyrics", "reupload"
    ]);

    const words = stripDateOperators(rawTitle)
      .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));

    if (words.length >= 2) {
      return words.slice(0, 5).join(" ");
    }

    const fallback = stripDateOperators(rawTitle)
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(" ");
    return fallback || "youtube";
  }

  function collectVideoRenderers(node, list = []) {
    if (!node || typeof node !== "object") return list;
    if (node.videoRenderer && node.videoRenderer.videoId) {
      list.push(node.videoRenderer);
      return list;
    }
    if (Array.isArray(node)) {
      for (const item of node) collectVideoRenderers(item, list);
    } else {
      for (const key of Object.keys(node)) {
        collectVideoRenderers(node[key], list);
      }
    }
    return list;
  }

  function extractText(field) {
    if (!field) return "";
    if (typeof field.simpleText === "string") return field.simpleText;
    if (Array.isArray(field.runs)) return field.runs.map((r) => r.text).join("");
    return "";
  }

  async function fetchYearVideosForTopic(topic, years) {
    const query = buildYearQuery(topic, years);
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`;
    const resp = await fetch(url, { credentials: "same-origin" });
    const html = await resp.text();

    const match =
      html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ||
      html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);

    if (!match) return [];

    const data = JSON.parse(match[1]);
    const rawRenderers = collectVideoRenderers(data);
    const currentVideoId = new URL(window.location.href).searchParams.get("v");

    const results = [];
    const seen = new Set();

    for (const v of rawRenderers) {
      const videoId = v.videoId;
      if (!videoId || videoId === currentVideoId || seen.has(videoId)) continue;

      const title = extractText(v.title);
      const channel =
        extractText(v.longBylineText) ||
        extractText(v.shortBylineText) ||
        extractText(v.ownerText);
      const published = extractText(v.publishedTimeText);
      const views =
        extractText(v.shortViewCountText) || extractText(v.viewCountText);
      const duration = extractText(v.lengthText);

      if (!title) continue;
      if (state.strictFilter && !matchesTargetYears(published, title, years)) {
        continue;
      }

      seen.add(videoId);
      results.push({
        videoId,
        title,
        channel,
        published,
        views,
        duration,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
      });

      if (results.length >= 18) break;
    }

    return results;
  }

  // Inject our own year-matched end-screen grid inside #movie_player .html5-endscreen
  // while CSS hides all native YouTube modern endscreen tiles
  function syncEndscreenRecommendations() {
    if (window.location.pathname !== "/watch") return;

    const endscreenContainers = document.querySelectorAll(
      "#movie_player .ytp-endscreen-content, #movie_player .ytp-fullscreen-grid-stills-container"
    );

    if (!state.enabled || !state.years.length) {
      document.querySelectorAll("#yt-yf-endscreen-grid").forEach((el) => el.remove());
      lastEndscreenSignature = "";
      return;
    }

    if (!endscreenContainers.length || !cachedSidebarVideos.length) return;

    const sig = cachedSidebarVideos
      .slice(0, 9)
      .map((v) => v.videoId)
      .join(",");

    endscreenContainers.forEach((container) => {
      let customGrid = container.querySelector(".yt-yf-endscreen-grid");
      if (customGrid && customGrid.dataset.sig === sig) return;

      if (customGrid) customGrid.remove();

      customGrid = document.createElement("div");
      customGrid.className = "yt-yf-endscreen-grid";
      customGrid.setAttribute("data-oldtube-tile", "1");
      customGrid.dataset.sig = sig;

      const items = cachedSidebarVideos.slice(0, 6);
      for (const v of items) {
        const card = document.createElement("a");
        card.className = "yt-yf-endscreen-card";
        card.href = `/watch?v=${encodeURIComponent(v.videoId)}`;
        card.style.backgroundImage = `url("${v.thumbnail}")`;

        const overlay = document.createElement("div");
        overlay.className = "yt-yf-endscreen-overlay";

        const titleEl = document.createElement("div");
        titleEl.className = "yt-yf-endscreen-title";
        titleEl.textContent = v.title;

        const metaEl = document.createElement("div");
        metaEl.className = "yt-yf-endscreen-meta";
        metaEl.textContent = [v.channel, v.views, v.published].filter(Boolean).join(" • ");

        overlay.appendChild(titleEl);
        overlay.appendChild(metaEl);

        if (v.duration) {
          const durEl = document.createElement("span");
          durEl.className = "yt-yf-endscreen-duration";
          durEl.textContent = v.duration;
          card.appendChild(durEl);
        }

        card.appendChild(overlay);
        card.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.location.href = `/watch?v=${encodeURIComponent(v.videoId)}`;
          },
          true
        );

        customGrid.appendChild(card);
      }

      container.appendChild(customGrid);
    });
  }

  // Toggle visibility of YouTube's default watch sidebar feed when our year sidebar feed is active
  function setNativeSidebarHidden(hide) {
    const nativeRelated = document.querySelectorAll(
      "ytd-watch-flexy #related, ytd-watch-flexy ytd-watch-next-secondary-results-renderer"
    );
    nativeRelated.forEach((el) => {
      if (el.querySelector && el.querySelector("#yt-year-sidebar-widget")) return;
      el.classList.toggle("yt-yf-hidden-by-year", hide);
    });
  }

  function renderSidebarMessage(container, text) {
    container.replaceChildren();
    const msg = document.createElement("div");
    msg.className = "yt-yf-sb-loading";
    msg.textContent = text;
    container.appendChild(msg);
  }

  function renderSidebarVideoCards(container, videos) {
    container.replaceChildren();
    for (const v of videos) {
      const link = document.createElement("a");
      link.className = "yt-yf-sb-video-card";
      link.href = `/watch?v=${encodeURIComponent(v.videoId)}`;

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "yt-yf-sb-thumb-wrap";

      const img = document.createElement("img");
      img.className = "yt-yf-sb-thumb";
      img.src = v.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      thumbWrap.appendChild(img);

      if (v.duration) {
        const dur = document.createElement("span");
        dur.className = "yt-yf-sb-duration";
        dur.textContent = v.duration;
        thumbWrap.appendChild(dur);
      }

      const meta = document.createElement("div");
      meta.className = "yt-yf-sb-meta";

      const titleDiv = document.createElement("div");
      titleDiv.className = "yt-yf-sb-vtitle";
      titleDiv.title = v.title;
      titleDiv.textContent = v.title;

      const chanDiv = document.createElement("div");
      chanDiv.className = "yt-yf-sb-vchannel";
      chanDiv.textContent = v.channel;

      const statsDiv = document.createElement("div");
      statsDiv.className = "yt-yf-sb-vstats";
      statsDiv.textContent = [v.views, v.published].filter(Boolean).join(" • ");

      meta.appendChild(titleDiv);
      meta.appendChild(chanDiv);
      meta.appendChild(statsDiv);

      link.appendChild(thumbWrap);
      link.appendChild(meta);
      container.appendChild(link);
    }
  }

  async function loadSidebarYearFeed(force = false) {
    if (window.location.pathname !== "/watch") {
      setNativeSidebarHidden(false);
      return;
    }

    const feedContainer = document.getElementById("yt-yf-sidebar-feed");
    const statusBadge = document.getElementById("yt-yf-sidebar-status");
    const topicInput = document.getElementById("yt-yf-sb-topic-input");

    if (!state.enabled || !state.years.length) {
      cachedSidebarVideos = [];
      lastSidebarFetchKey = "";
      if (feedContainer) {
        feedContainer.style.display = "none";
        feedContainer.replaceChildren();
      }
      setNativeSidebarHidden(false);
      if (statusBadge) statusBadge.textContent = "Off";
      syncEndscreenRecommendations();
      return;
    }

    const currentVid = new URL(window.location.href).searchParams.get("v") || "";
    const customTopic =
      topicInput && topicInput.dataset.vid === currentVid && topicInput.value.trim()
        ? topicInput.value.trim()
        : "";
    const topic = customTopic || getCurrentWatchKeywords();

    if (topicInput && (!topicInput.value.trim() || topicInput.dataset.vid !== currentVid)) {
      topicInput.value = topic;
      topicInput.dataset.vid = currentVid;
    }

    const fetchKey = `${currentVid}|${topic}|${state.years.join(",")}|${state.strictFilter}`;
    if (!force && fetchKey === lastSidebarFetchKey) {
      syncEndscreenRecommendations();
      return;
    }
    if (isFetchingSidebar) return;

    lastSidebarFetchKey = fetchKey;
    isFetchingSidebar = true;

    const yearsLabel = formatYearsCompact(state.years);
    if (statusBadge) statusBadge.textContent = `Loading ${yearsLabel}...`;
    if (feedContainer && state.showSidebarWidget) {
      feedContainer.style.display = "flex";
      renderSidebarMessage(feedContainer, `⏳ Loading ${yearsLabel} sidebar feed for "${topic}"...`);
      setNativeSidebarHidden(true);
    }

    try {
      let videos = await fetchYearVideosForTopic(topic, state.years);

      if (videos.length < 3 && topic.split(/\s+/).length > 2) {
        const broader = topic.split(/\s+/).slice(0, 2).join(" ");
        const more = await fetchYearVideosForTopic(broader, state.years);
        const existingIds = new Set(videos.map((v) => v.videoId));
        for (const m of more) {
          if (!existingIds.has(m.videoId)) videos.push(m);
        }
      }

      cachedSidebarVideos = videos;
      syncEndscreenRecommendations();

      if (!feedContainer || !state.showSidebarWidget) return;

      if (!videos.length) {
        renderSidebarMessage(
          feedContainer,
          `No videos found from ${yearsLabel} for "${topic}". Try editing the sidebar topic above.`
        );
        if (statusBadge) statusBadge.textContent = `${yearsLabel} · 0 videos`;
        return;
      }

      if (statusBadge) statusBadge.textContent = `${yearsLabel} · ${videos.length} videos`;
      renderSidebarVideoCards(feedContainer, videos);
    } catch (err) {
      if (feedContainer) {
        renderSidebarMessage(feedContainer, "Could not load sidebar feed.");
      }
      setNativeSidebarHidden(false);
    } finally {
      isFetchingSidebar = false;
    }
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

      const topRow = document.createElement("div");
      topRow.className = "yt-yf-top-row";

      const brand = document.createElement("div");
      brand.className = "yt-yf-brand";
      const dot = document.createElement("span");
      dot.className = "yt-yf-dot";
      dot.id = "yt-yf-dot";
      const brandLabel = document.createElement("span");
      brandLabel.textContent = "⏳ old-tube";
      brand.appendChild(dot);
      brand.appendChild(brandLabel);

      const actions = document.createElement("div");
      actions.className = "yt-yf-actions";

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "yt-yf-apply";
      applyBtn.id = "yt-yf-apply-btn";
      applyBtn.textContent = "Apply Year";
      applyBtn.addEventListener("click", () => {
        applyYearsToSearch(state.draftYears, state.draftYears.length > 0);
      });

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "yt-yf-clear";
      clearBtn.id = "yt-yf-clear-btn";
      clearBtn.textContent = "Reset";
      clearBtn.addEventListener("click", () => {
        state.draftYears = [];
        applyYearsToSearch([], false);
      });

      actions.appendChild(applyBtn);
      actions.appendChild(clearBtn);

      const rightControls = document.createElement("div");
      rightControls.className = "yt-yf-right-controls";

      const strictLabel = document.createElement("label");
      strictLabel.className = "yt-yf-strict-label";
      strictLabel.title = "Hide Shorts shelves and videos outside your selected years";

      const strictInput = document.createElement("input");
      strictInput.type = "checkbox";
      strictInput.id = "yt-yf-strict-toggle";
      strictInput.checked = state.strictFilter;
      strictInput.addEventListener("change", (e) => {
        state.strictFilter = e.target.checked;
        browser.storage.local.set({ strictFilter: state.strictFilter });
        scheduleFilter(true);
      });

      const strictSpan = document.createElement("span");
      strictSpan.textContent = "Strict";
      strictLabel.appendChild(strictInput);
      strictLabel.appendChild(strictSpan);

      const statusDiv = document.createElement("div");
      statusDiv.className = "yt-yf-status";
      const statusText = document.createElement("span");
      statusText.id = "yt-yf-status-text";
      statusText.textContent = "All years shown";
      statusDiv.appendChild(statusText);

      rightControls.appendChild(strictLabel);
      rightControls.appendChild(statusDiv);

      topRow.appendChild(brand);
      topRow.appendChild(actions);
      topRow.appendChild(rightControls);

      const allYearsDiv = document.createElement("div");
      allYearsDiv.className = "yt-yf-all-years";
      appendAllYearButtons(allYearsDiv, "yt-yf-chip");

      bar.appendChild(topRow);
      bar.appendChild(allYearsDiv);

      targetContainer.prepend(bar);
      updateAllUI();
    } finally {
      isUpdatingDOM = false;
    }
  }

  // Inject the sidebar widget + year video feed at the top of #secondary-inner / #secondary
  function injectSidebarWidget() {
    const existing = document.getElementById("yt-year-sidebar-widget");
    if (!state.showSidebarWidget || window.location.pathname !== "/watch") {
      if (existing) existing.remove();
      setNativeSidebarHidden(false);
      return;
    }

    if (existing) {
      updateAllUI();
      return;
    }

    const sidebarTarget =
      document.querySelector("ytd-watch-flexy #secondary-inner") ||
      document.querySelector("ytd-watch-flexy #secondary");

    if (!sidebarTarget) return;

    isUpdatingDOM = true;
    try {
      const widget = document.createElement("div");
      widget.id = "yt-year-sidebar-widget";

      const header = document.createElement("div");
      header.className = "yt-yf-sb-header";

      const title = document.createElement("div");
      title.className = "yt-yf-sb-title";
      const sbDot = document.createElement("span");
      sbDot.className = "yt-yf-dot";
      sbDot.id = "yt-yf-sb-dot";
      const sbTitleText = document.createElement("span");
      sbTitleText.textContent = "⏳ old-tube Sidebar";
      title.appendChild(sbDot);
      title.appendChild(sbTitleText);

      const badge = document.createElement("span");
      badge.className = "yt-yf-sb-badge";
      badge.id = "yt-yf-sidebar-status";
      badge.textContent = "Off";

      const sbApply = document.createElement("button");
      sbApply.type = "button";
      sbApply.className = "yt-yf-sb-apply";
      sbApply.id = "yt-yf-sb-apply-btn";
      sbApply.textContent = "Apply";
      sbApply.addEventListener("click", () => {
        applyYearsToSearch(state.draftYears, state.draftYears.length > 0);
      });

      const sbReset = document.createElement("button");
      sbReset.type = "button";
      sbReset.className = "yt-yf-sb-reset";
      sbReset.id = "yt-yf-sb-reset-btn";
      sbReset.textContent = "Reset";
      sbReset.addEventListener("click", () => {
        state.draftYears = [];
        applyYearsToSearch([], false);
      });

      header.appendChild(title);
      header.appendChild(badge);
      header.appendChild(sbApply);
      header.appendChild(sbReset);

      const chipsDiv = document.createElement("div");
      chipsDiv.className = "yt-yf-sb-chips";
      appendAllYearButtons(chipsDiv, "yt-yf-sb-chip");

      const topicRow = document.createElement("div");
      topicRow.className = "yt-yf-sb-topic-row";
      topicRow.id = "yt-yf-sb-topic-row";
      topicRow.style.display = "none";

      const topicInput = document.createElement("input");
      topicInput.type = "text";
      topicInput.id = "yt-yf-sb-topic-input";
      topicInput.className = "yt-yf-sb-topic-input";
      topicInput.placeholder = "Sidebar topic...";
      topicInput.title = "Topic used to populate sidebar videos for your selected year(s)";
      topicInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          loadSidebarYearFeed(true);
        }
      });

      const topicBtn = document.createElement("button");
      topicBtn.type = "button";
      topicBtn.id = "yt-yf-sb-topic-btn";
      topicBtn.className = "yt-yf-sb-topic-btn";
      topicBtn.textContent = "Refresh";
      topicBtn.addEventListener("click", () => {
        loadSidebarYearFeed(true);
      });

      topicRow.appendChild(topicInput);
      topicRow.appendChild(topicBtn);

      const feedDiv = document.createElement("div");
      feedDiv.className = "yt-yf-sidebar-feed";
      feedDiv.id = "yt-yf-sidebar-feed";
      feedDiv.style.display = "none";

      widget.appendChild(header);
      widget.appendChild(chipsDiv);
      widget.appendChild(topicRow);
      widget.appendChild(feedDiv);

      sidebarTarget.prepend(widget);

      updateAllUI();
      if (state.enabled && state.years.length) {
        setTimeout(() => loadSidebarYearFeed(true), 300);
      }
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
      const sbTopicRow = document.getElementById("yt-yf-sb-topic-row");
      const sbChips = widget.querySelectorAll(".yt-yf-sb-chip");

      if (sbDot) sbDot.classList.toggle("active", isActive);
      if (sbApply) {
        sbApply.textContent =
          draftCount > 1
            ? `Apply (${draftCount})`
            : draftCount === 1
            ? `Apply ${state.draftYears[0]}`
            : "Apply";
      }
      if (sbTopicRow) {
        sbTopicRow.style.display = isActive ? "flex" : "none";
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
        if (window.location.pathname === "/watch") {
          setTimeout(() => loadSidebarYearFeed(false), 350);
        }
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
    lastSidebarFetchKey = "";
    cachedSidebarVideos = [];
    lastEndscreenSignature = "";
    setTimeout(syncStateAndRun, 250);
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
      syncRootActiveAttribute();
      injectSidebarWidget();
      if (state.enabled && state.years.length) {
        loadSidebarYearFeed(false);
        syncEndscreenRecommendations();
      }
    }
  }, 600);

  setupSearchInterceptors();
  syncStateAndRun();
})();
