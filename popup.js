const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2005;

const yearsGrid = document.getElementById("years-grid");
const sidebarCheckbox = document.getElementById("sidebar-checkbox");
const strictCheckbox = document.getElementById("strict-checkbox");
const statusBadge = document.getElementById("status-badge");
const applyBtn = document.getElementById("apply-btn");
const clearBtn = document.getElementById("clear-btn");

let selectedYears = [];

function normalizeYears(arr) {
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : String(arr).split(",");
  const cleaned = list
    .map((y) => parseInt(String(y).trim(), 10))
    .filter((y) => !isNaN(y) && y >= MIN_YEAR && y <= CURRENT_YEAR);
  return [...new Set(cleaned)].sort((a, b) => a - b).map(String);
}

function buildYearsGrid() {
  yearsGrid.replaceChildren();
  for (let y = MIN_YEAR; y <= CURRENT_YEAR; y++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "year-btn";
    btn.dataset.year = String(y);
    btn.textContent = String(y);

    btn.addEventListener("click", () => {
      const yearStr = String(y);
      selectedYears = selectedYears.includes(yearStr)
        ? selectedYears.filter((item) => item !== yearStr)
        : normalizeYears([...selectedYears, yearStr]);
      renderUI();
    });

    yearsGrid.appendChild(btn);
  }
}

function renderUI() {
  const count = selectedYears.length;

  if (count > 0) {
    statusBadge.textContent = count <= 3 ? selectedYears.join(", ") : `${count} YEARS`;
    statusBadge.classList.remove("off");
    applyBtn.textContent = count > 1 ? `Apply Years (${count})` : `Apply ${selectedYears[0]}`;
  } else {
    statusBadge.textContent = "OFF";
    statusBadge.classList.add("off");
    applyBtn.textContent = "Apply Year";
  }

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

buildYearsGrid();

browser.storage.local
  .get(["enabled", "years", "year", "strictFilter", "showSidebarWidget"])
  .then((data) => {
    const initialYears = data.years || (data.year ? [data.year] : []);
    selectedYears = data.enabled ? normalizeYears(initialYears) : [];
    strictCheckbox.checked = data.strictFilter !== false;
    sidebarCheckbox.checked = data.showSidebarWidget !== false;
    renderUI();
  });

applyBtn.addEventListener("click", () => {
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
