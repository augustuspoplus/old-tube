const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2005;

const yearSelect = document.getElementById("year-select");
const strictCheckbox = document.getElementById("strict-checkbox");
const statusBadge = document.getElementById("status-badge");
const applyBtn = document.getElementById("apply-btn");
const clearBtn = document.getElementById("clear-btn");
const presetBtns = document.querySelectorAll(".preset-btn");

// Populate dropdown from current year back to 2005
function populateYears() {
  const anyOption = document.createElement("option");
  anyOption.value = "";
  anyOption.textContent = "Any Year (Disabled)";
  yearSelect.appendChild(anyOption);

  for (let y = CURRENT_YEAR; y >= MIN_YEAR; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
}

function updateUI(enabled, year, strictFilter) {
  yearSelect.value = enabled && year ? String(year) : "";
  strictCheckbox.checked = strictFilter !== false;

  if (enabled && year) {
    statusBadge.textContent = year;
    statusBadge.classList.remove("off");
  } else {
    statusBadge.textContent = "OFF";
    statusBadge.classList.add("off");
  }

  presetBtns.forEach((btn) => {
    if (enabled && btn.dataset.year === String(year)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function saveAndBroadcast(enabled, year, strictFilter) {
  browser.storage.local
    .set({ enabled, year, strictFilter })
    .then(() => {
      updateUI(enabled, year, strictFilter);
      return browser.tabs.query({ active: true, currentWindow: true });
    })
    .then((tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes("youtube.com")) {
        browser.tabs.sendMessage(tabs[0].id, {
          type: "APPLY_YEAR_FILTER",
          enabled,
          year,
          strictFilter
        });
      }
    });
}

populateYears();

browser.storage.local.get(["enabled", "year", "strictFilter"]).then((data) => {
  updateUI(Boolean(data.enabled), data.year || "", data.strictFilter !== false);
});

applyBtn.addEventListener("click", () => {
  const selectedYear = yearSelect.value;
  saveAndBroadcast(Boolean(selectedYear), selectedYear, strictCheckbox.checked);
});

yearSelect.addEventListener("change", () => {
  const selectedYear = yearSelect.value;
  saveAndBroadcast(Boolean(selectedYear), selectedYear, strictCheckbox.checked);
});

strictCheckbox.addEventListener("change", () => {
  const selectedYear = yearSelect.value;
  saveAndBroadcast(Boolean(selectedYear), selectedYear, strictCheckbox.checked);
});

clearBtn.addEventListener("click", () => {
  saveAndBroadcast(false, "", strictCheckbox.checked);
});

presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const y = btn.dataset.year;
    saveAndBroadcast(true, y, strictCheckbox.checked);
  });
});
