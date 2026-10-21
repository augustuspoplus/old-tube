const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2005;

const yearsGrid = document.getElementById("years-grid");
const selectedPills = document.getElementById("selected-pills");
const selectedCountLabel = document.getElementById("selected-count-label");
const clearInlineBtn = document.getElementById("clear-inline-btn");
const rangeFrom = document.getElementById("range-from");
const rangeTo = document.getElementById("range-to");
const rangeAddBtn = document.getElementById("range-add-btn");
const sidebarCheckbox = document.getElementById("sidebar-checkbox");
const strictCheckbox = document.getElementById("strict-checkbox");
const statusBadge = document.getElementById("status-badge");
const clearBtn = document.getElementById("clear-btn");

let selectedYears = [];
let lastClickedYear = null;

function normalizeYears(arr) {
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : String(arr).split(",");
  const cleaned = list
    .map((y) => parseInt(String(y).trim(), 10))
    .filter((y) => !isNaN(y) && y >= MIN_YEAR && y <= CURRENT_YEAR);
  return [...new Set(cleaned)].sort((a, b) => a - b).map(String);
}

function buildControls() {
  yearsGrid.innerHTML = "";
  rangeFrom.innerHTML = "";
  rangeTo.innerHTML = "";

  for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "year-btn";
    btn.dataset.year = String(y);
    btn.textContent = String(y);
    btn.title = "Click to toggle & apply · Shift+Click to add range";

    btn.addEventListener("click", (e) => {
      const yearStr = String(y);
      if (e.shiftKey && lastClickedYear !== null) {
        const start = Math.min(parseInt(lastClickedYear, 10), y);
        const end = Math.max(parseInt(lastClickedYear, 10), y);
        const span = [];
        for (let curr = start; curr <= end; curr++) span.push(String(curr));
        selectedYears = normalizeYears([...selectedYears, ...span]);
      } else {
        selectedYears = selectedYears.includes(yearStr)
          ? selectedYears.filter((item) => item !== yearStr)
          : normalizeYears([...selectedYears, yearStr]);
      }
      lastClickedYear = yearStr;
      saveAndBroadcast(
        selectedYears.length > 0,
        selectedYears,
        strictCheckbox.checked,
        sidebarCheckbox.checked
      );
    });

    yearsGrid.appendChild(btn);

    const optFrom = document.createElement("option");
    optFrom.value = String(y);
    optFrom.textContent = String(y);
    rangeFrom.appendChild(optFrom);

    const optTo = document.createElement("option");
    optTo.value = String(y);
    optTo.textContent = String(y);
    rangeTo.appendChild(optTo);
  }

  rangeFrom.value = "2010";
  rangeTo.value = "2014";
}

function toggleRange(startYear, endYear) {
  const a = parseInt(startYear, 10);
  const b = parseInt(endYear, 10);
  if (isNaN(a) || isNaN(b)) return;
  const min = Math.max(MIN_YEAR, Math.min(a, b));
  const max = Math.min(CURRENT_YEAR, Math.max(a, b));
  const span = [];
  for (let y = min; y <= max; y++) span.push(String(y));

  const allSelected = span.every((y) => selectedYears.includes(y));
  if (allSelected) {
    selectedYears = selectedYears.filter((y) => !span.includes(y));
  } else {
    selectedYears = normalizeYears([...selectedYears, ...span]);
  }
  saveAndBroadcast(
    selectedYears.length > 0,
    selectedYears,
    strictCheckbox.checked,
    sidebarCheckbox.checked
  );
}

function renderUI() {
  const count = selectedYears.length;
  selectedCountLabel.textContent = `Selected Years (${count})`;
  clearInlineBtn.style.display = count > 0 ? "inline-block" : "none";

  if (count > 0) {
    statusBadge.textContent = count === 1 ? selectedYears[0] : `${count} YEARS`;
    statusBadge.classList.remove("off");
  } else {
    statusBadge.textContent = "OFF";
    statusBadge.classList.add("off");
  }

  // Render active pills
  if (count === 0) {
    selectedPills.innerHTML = `<span class="empty-hint">Click any years below to auto-apply</span>`;
  } else {
    selectedPills.innerHTML = selectedYears
      .map(
        (y) =>
          `<button type="button" class="year-pill" data-year="${y}" title="Remove ${y}">${y} <span>×</span></button>`
      )
      .join("");

    selectedPills.querySelectorAll(".year-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const y = pill.dataset.year;
        selectedYears = selectedYears.filter((item) => item !== y);
        saveAndBroadcast(
          selectedYears.length > 0,
          selectedYears,
          strictCheckbox.checked,
          sidebarCheckbox.checked
        );
      });
    });
  }

  // Highlight year grid buttons
  yearsGrid.querySelectorAll(".year-btn").forEach((btn) => {
    btn.classList.toggle("active", selectedYears.includes(btn.dataset.year));
  });
}

function saveAndBroadcast(enabled, years, strictFilter, showSidebarWidget) {
  const norm = normalizeYears(years);
  const isEnabled = Boolean(enabled && norm.length);
  selectedYears = isEnabled ? norm : [];

  browser.storage.local
    .set({
      enabled: isEnabled,
      years: selectedYears,
      year: selectedYears[0] || "",
      strictFilter,
      showSidebarWidget
    })
    .then(() => {
      renderUI();
      return browser.tabs.query({ active: true, currentWindow: true });
    })
    .then((tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes("youtube.com")) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: "APPLY_YEAR_FILTER",
          enabled: isEnabled,
          years: selectedYears,
          year: selectedYears[0] || "",
          strictFilter,
          showSidebarWidget
        });
      }
    });
}

buildControls();

browser.storage.local
  .get(["enabled", "years", "year", "strictFilter", "showSidebarWidget"])
  .then((data) => {
    const initialYears = data.years || (data.year ? [data.year] : []);
    selectedYears = data.enabled ? normalizeYears(initialYears) : [];
    strictCheckbox.checked = data.strictFilter !== false;
    sidebarCheckbox.checked = data.showSidebarWidget !== false;
    renderUI();
  });

rangeAddBtn.addEventListener("click", () => {
  toggleRange(rangeFrom.value, rangeTo.value);
});

clearInlineBtn.addEventListener("click", () => {
  saveAndBroadcast(false, [], strictCheckbox.checked, sidebarCheckbox.checked);
});

sidebarCheckbox.addEventListener("change", () => {
  saveAndBroadcast(
    selectedYears.length > 0,
    selectedYears,
    strictCheckbox.checked,
    sidebarCheckbox.checked
  );
});

strictCheckbox.addEventListener("change", () => {
  saveAndBroadcast(
    selectedYears.length > 0,
    selectedYears,
    strictCheckbox.checked,
    sidebarCheckbox.checked
  );
});

clearBtn.addEventListener("click", () => {
  saveAndBroadcast(false, [], strictCheckbox.checked, sidebarCheckbox.checked);
});
