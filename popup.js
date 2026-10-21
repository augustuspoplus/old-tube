const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2005;

const yearSelect = document.getElementById("year-select");
const strictCheckbox = document.getElementById("strict-checkbox");
const statusBadge = document.getElementById("status-badge");
const applyBtn = document.getElementById("apply-btn");
const clearBtn = document.getElementById("clear-btn");
const presetBtns = document.querySelectorAll(".preset-btn");

let selectedYears = [];

function normalizeYears(arr) {
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : String(arr).split(",");
  return [...new Set(list.map((y) => String(y).trim()).filter(Boolean))].sort();
}

function populateYears() {
  const anyOption = document.createElement("option");
  anyOption.value = "";
  anyOption.textContent = "+ Toggle a Year (2005 – Present)";
  yearSelect.appendChild(anyOption);

  for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
}

function updateUI(enabled, years, strictFilter) {
  selectedYears = enabled ? normalizeYears(years) : [];
  yearSelect.value = "";
  strictCheckbox.checked = strictFilter !== false;

  if (enabled && selectedYears.length) {
    statusBadge.textContent = selectedYears.join(", ");
    statusBadge.classList.remove("off");
  } else {
    statusBadge.textContent = "OFF";
    statusBadge.classList.add("off");
  }

  presetBtns.forEach((btn) => {
    if (enabled && selectedYears.includes(btn.dataset.year)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function saveAndBroadcast(enabled, years, strictFilter) {
  const norm = normalizeYears(years);
  const isEnabled = Boolean(enabled && norm.length);
  browser.storage.local
    .set({
      enabled: isEnabled,
      years: norm,
      year: norm[0] || "",
      strictFilter
    })
    .then(() => {
      updateUI(isEnabled, norm, strictFilter);
      return browser.tabs.query({ active: true, currentWindow: true });
    })
    .then((tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes("youtube.com")) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: "APPLY_YEAR_FILTER",
          enabled: isEnabled,
          years: norm,
          year: norm[0] || "",
          strictFilter
        });
      }
    });
}

populateYears();

browser.storage.local.get(["enabled", "years", "year", "strictFilter"]).then((data) => {
  const initialYears = data.years || (data.year ? [data.year] : []);
  updateUI(Boolean(data.enabled), initialYears, data.strictFilter !== false);
});

yearSelect.addEventListener("change", () => {
  const y = yearSelect.value;
  if (!y) return;
  const next = selectedYears.includes(y)
    ? selectedYears.filter((item) => item !== y)
    : [...selectedYears, y];
  saveAndBroadcast(next.length > 0, next, strictCheckbox.checked);
});

strictCheckbox.addEventListener("change", () => {
  saveAndBroadcast(selectedYears.length > 0, selectedYears, strictCheckbox.checked);
});

applyBtn.addEventListener("click", () => {
  saveAndBroadcast(selectedYears.length > 0, selectedYears, strictCheckbox.checked);
});

clearBtn.addEventListener("click", () => {
  saveAndBroadcast(false, [], strictCheckbox.checked);
});

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const y = btn.dataset.year;
    const next = selectedYears.includes(y)
      ? selectedYears.filter((item) => item !== y)
      : [...selectedYears, y];
    saveAndBroadcast(next.length > 0, next, strictCheckbox.checked);
  });
});
