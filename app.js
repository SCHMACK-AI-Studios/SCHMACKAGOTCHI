(function () {
  "use strict";

  const STORAGE_KEY = "schmackagotchi.save.v1";
  const AWAKE_START_HOUR = 8;
  const SLEEP_START_HOUR = 19;
  const HUNGER_DECAY_MS = 2 * 60 * 60 * 1000;
  const MAX_HEARTS = 5;

  const ACHIEVEMENTS = [
    "Earn a Braze certificate",
    "Upsell client hours",
    "Complete a brand refresh",
    "Develop a brand tone of voice",
    "Earn 100+ reactions on the LinkedIn SCHMACK account",
    "Complete your Growth Matrix goals"
  ];

  const TOYS = [
    { name: "Cat teaser with feather", className: "toy-teaser" },
    { name: "Fish toy", className: "toy-fish" },
    { name: "Small ball", className: "toy-ball" },
    { name: "Mouse toy", className: "toy-mouse" },
    { name: "Small tunnel toy", className: "toy-tunnel" }
  ];

  const app = document.querySelector("#app");

  const ui = {
    editingTask: false,
    optionsOpen: false,
    confirmReset: false,
    reward: null,
    reaction: false,
    error: "",
    now: new Date()
  };

  let state = loadState();
  let rewardTimer = 0;

  function defaultState() {
    const now = new Date();
    return {
      petName: "",
      dailyTaskText: "",
      todayTaskCompleted: false,
      achievementsCheckedToday: [],
      hunger: MAX_HEARTS,
      happiness: 0,
      collectedToys: [],
      catNapActive: false,
      lastDailyResetDate: resetKeyFor(now),
      lastHungerDecayTimestamp: now.toISOString()
    };
  }

  function loadState() {
    const fallback = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return fallback;
      }
      const parsed = JSON.parse(raw);
      const merged = { ...fallback, ...parsed };
      merged.petName = typeof merged.petName === "string" ? merged.petName : "";
      merged.dailyTaskText = typeof merged.dailyTaskText === "string" ? merged.dailyTaskText : "";
      merged.todayTaskCompleted = Boolean(merged.todayTaskCompleted);
      merged.achievementsCheckedToday = Array.isArray(merged.achievementsCheckedToday)
        ? merged.achievementsCheckedToday.filter((item) => Number.isInteger(item) && item >= 0 && item < ACHIEVEMENTS.length)
        : [];
      merged.hunger = clampHeartValue(merged.hunger);
      merged.collectedToys = Array.isArray(merged.collectedToys)
        ? merged.collectedToys.filter((item) => Number.isInteger(item) && item >= 0 && item < TOYS.length).slice(0, MAX_HEARTS)
        : [];
      merged.happiness = Math.max(clampHeartValue(merged.happiness), merged.collectedToys.length);
      merged.catNapActive = Boolean(merged.catNapActive);
      if (!Number.isFinite(new Date(merged.lastHungerDecayTimestamp).getTime())) {
        merged.lastHungerDecayTimestamp = new Date().toISOString();
      }
      if (typeof merged.lastDailyResetDate !== "string" || !merged.lastDailyResetDate) {
        merged.lastDailyResetDate = resetKeyFor(new Date());
      }
      return merged;
    } catch (error) {
      console.warn("Could not read SCHMACKAGOTCHI save.", error);
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function clampHeartValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(MAX_HEARTS, Math.round(number)));
  }

  function hasStarted() {
    return state.petName.trim() !== "" && state.dailyTaskText.trim() !== "";
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function resetBoundaryFor(date) {
    const boundary = new Date(date);
    boundary.setHours(AWAKE_START_HOUR, 0, 0, 0);
    if (date < boundary) {
      boundary.setDate(boundary.getDate() - 1);
    }
    return boundary;
  }

  function nextResetBoundaryFor(date) {
    const boundary = resetBoundaryFor(date);
    boundary.setDate(boundary.getDate() + 1);
    return boundary;
  }

  function resetKeyFor(date) {
    return localDateKey(resetBoundaryFor(date));
  }

  function isAwakeAt(date) {
    const hour = date.getHours();
    return hour >= AWAKE_START_HOUR && hour < SLEEP_START_HOUR;
  }

  function awakeWindowFor(date) {
    const start = new Date(date);
    start.setHours(AWAKE_START_HOUR, 0, 0, 0);
    const end = new Date(date);
    end.setHours(SLEEP_START_HOUR, 0, 0, 0);
    return { start, end };
  }

  function awakeMsBetween(start, end) {
    if (!(start < end)) {
      return 0;
    }

    let total = 0;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);

    const finalDay = new Date(end);
    finalDay.setHours(0, 0, 0, 0);

    while (cursor <= finalDay) {
      const { start: awakeStart, end: awakeEnd } = awakeWindowFor(cursor);
      const segmentStart = Math.max(start.getTime(), awakeStart.getTime());
      const segmentEnd = Math.min(end.getTime(), awakeEnd.getTime());
      if (segmentEnd > segmentStart) {
        total += segmentEnd - segmentStart;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return total;
  }

  function advanceByAwakeMs(start, amountMs) {
    let remaining = amountMs;
    const cursor = new Date(start);

    while (remaining > 0) {
      const { start: awakeStart, end: awakeEnd } = awakeWindowFor(cursor);

      if (cursor < awakeStart) {
        cursor.setTime(awakeStart.getTime());
      }

      if (cursor >= awakeEnd) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(AWAKE_START_HOUR, 0, 0, 0);
        continue;
      }

      const available = awakeEnd.getTime() - cursor.getTime();
      const used = Math.min(available, remaining);
      cursor.setTime(cursor.getTime() + used);
      remaining -= used;
    }

    return cursor;
  }

  function applyDailyReset(now) {
    const currentKey = resetKeyFor(now);
    if (state.lastDailyResetDate === currentKey) {
      return false;
    }

    state.todayTaskCompleted = false;
    state.achievementsCheckedToday = [];
    state.lastDailyResetDate = currentKey;
    return true;
  }

  function applyHungerDecay(now) {
    if (state.catNapActive || state.todayTaskCompleted || state.hunger <= 0) {
      return false;
    }

    const lastDecay = new Date(state.lastHungerDecayTimestamp);
    const start = Number.isFinite(lastDecay.getTime()) ? lastDecay : now;
    const elapsedAwakeMs = awakeMsBetween(start, now);
    const heartsToLose = Math.floor(elapsedAwakeMs / HUNGER_DECAY_MS);

    if (heartsToLose <= 0) {
      return false;
    }

    const actualLoss = Math.min(heartsToLose, state.hunger);
    state.hunger = Math.max(0, state.hunger - actualLoss);
    if (state.hunger === 0) {
      state.lastHungerDecayTimestamp = now.toISOString();
    } else {
      state.lastHungerDecayTimestamp = advanceByAwakeMs(start, actualLoss * HUNGER_DECAY_MS).toISOString();
    }
    return true;
  }

  function syncClock() {
    const now = new Date();
    ui.now = now;
    const resetChanged = applyDailyReset(now);
    const hungerChanged = applyHungerDecay(now);
    if (resetChanged || hungerChanged) {
      saveState();
    }
  }

  function startGame(event) {
    event.preventDefault();
    const form = event.target;
    const petName = form.elements.petName.value.trim();
    const dailyTaskText = form.elements.dailyTaskText.value.trim();

    if (!petName || !dailyTaskText) {
      ui.error = "PET NAME AND DAILY TASK CANNOT BE BLANK.";
      render();
      return;
    }

    const now = new Date();
    state = {
      ...defaultState(),
      petName,
      dailyTaskText,
      lastDailyResetDate: resetKeyFor(now),
      lastHungerDecayTimestamp: now.toISOString()
    };
    ui.error = "";
    saveState();
    render();
  }

  function completeDailyTask() {
    syncClock();
    if (state.todayTaskCompleted) {
      render();
      return;
    }

    const now = new Date();
    state.todayTaskCompleted = true;
    state.hunger = MAX_HEARTS;
    state.lastHungerDecayTimestamp = nextResetBoundaryFor(now).toISOString();
    triggerReward({ type: "food" });
    saveState();
    render();
  }

  function completeAchievement(index) {
    syncClock();
    if (state.achievementsCheckedToday.includes(index)) {
      render();
      return;
    }

    state.achievementsCheckedToday.push(index);
    state.achievementsCheckedToday.sort((a, b) => a - b);

    if (state.collectedToys.length < MAX_HEARTS) {
      const toyIndex = state.collectedToys.length;
      state.collectedToys.push(toyIndex);
      state.happiness = Math.min(MAX_HEARTS, Math.max(state.happiness, state.collectedToys.length));
      triggerReward({ type: "toy", toyIndex });
    }

    saveState();
    render();
  }

  function saveTaskEdit(event) {
    event.preventDefault();
    const nextTask = event.target.elements.dailyTaskText.value.trim();
    if (!nextTask) {
      ui.error = "DAILY TASK CANNOT BE BLANK.";
      render();
      return;
    }

    syncClock();
    state.dailyTaskText = nextTask;
    ui.error = "";
    ui.editingTask = false;
    saveState();
    render();
  }

  function toggleCatNap() {
    syncClock();
    const now = new Date();
    state.catNapActive = !state.catNapActive;
    state.lastHungerDecayTimestamp = now.toISOString();
    saveState();
    render();
  }

  function resetGame() {
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    ui.editingTask = false;
    ui.optionsOpen = false;
    ui.confirmReset = false;
    ui.reward = null;
    ui.reaction = false;
    ui.error = "";
    render();
  }

  function triggerReward(reward) {
    window.clearTimeout(rewardTimer);
    ui.reward = reward;
    ui.reaction = true;
    rewardTimer = window.setTimeout(() => {
      ui.reward = null;
      ui.reaction = false;
      render();
    }, 1300);
  }

  function bowlName() {
    const name = state.petName.trim().toUpperCase();
    return name.length > 8 ? "SCHMACK" : name;
  }

  function catVisualState() {
    if (state.catNapActive || !isAwakeAt(ui.now)) {
      return "sleeping";
    }
    if (state.hunger === 0) {
      return "grumpy";
    }
    if (state.happiness === 0) {
      return "sad";
    }
    return "happy";
  }

  function statusText() {
    if (state.catNapActive) {
      return "CAT NAP MODE";
    }
    if (!isAwakeAt(ui.now)) {
      return "SLEEPING UNTIL 8:00AM";
    }
    if (state.hunger === 0) {
      return "HUNGRY AND GRUMPY";
    }
    if (state.happiness === 0) {
      return "NEEDS A TOY";
    }
    return "AWAKE AND READY";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderHearts(value) {
    return Array.from({ length: MAX_HEARTS }, (_, index) => {
      const filled = index < value;
      return `<span class="heart ${filled ? "filled" : "empty"}" aria-hidden="true"></span>`;
    }).join("");
  }

  function renderToyIcon(toyIndex, sizeClass = "") {
    const toy = TOYS[toyIndex];
    if (!toy) {
      return "";
    }
    return `<span class="toy-icon ${toy.className} ${sizeClass}" title="${escapeHtml(toy.name)}" aria-label="${escapeHtml(toy.name)}"></span>`;
  }

  function renderCat() {
    const visualState = catVisualState();
    const minuteSpot = Math.floor(ui.now.getTime() / 90000) % 3;
    const spotClass = visualState === "sleeping" ? "sleeping-spot" : `spot-${minuteSpot}`;
    const reactionClass = ui.reaction ? "reacting" : "";

    return `
      <div class="cat-zone ${spotClass}">
        <div class="cat ${visualState} ${reactionClass}" aria-label="${escapeHtml(state.petName)} the cat">
          <span class="cat-tail"></span>
          <span class="cat-body"></span>
          <span class="cat-leg left"></span>
          <span class="cat-leg right"></span>
          <span class="cat-ear left"></span>
          <span class="cat-ear right"></span>
          <span class="cat-head"></span>
          <span class="cat-eye left"></span>
          <span class="cat-eye right"></span>
          <span class="cat-nose"></span>
          <span class="cat-mouth"></span>
          <span class="zzz">Z Z Z</span>
        </div>
      </div>
    `;
  }

  function renderRoom() {
    const bowlLabel = escapeHtml(bowlName());
    const roomToys = state.collectedToys.map((toyIndex) => renderToyIcon(toyIndex)).join("");
    const hasFood = state.todayTaskCompleted ? "has-food" : "";

    return `
      <section class="room-wrap" aria-label="Pixel living room">
        <div class="room">
          <div class="window" aria-hidden="true"></div>
          <div class="poster">SCHMACK</div>
          <div class="cat-tree" aria-hidden="true">
            <span class="tree-post tall"></span>
            <span class="tree-post short"></span>
            <span class="tree-platform top"></span>
            <span class="tree-platform middle"></span>
            <span class="tree-base"></span>
          </div>
          <div class="rug" aria-hidden="true"></div>
          ${renderCat()}
          <div class="room-toys">${roomToys}</div>
          <div class="bowl food-bowl ${hasFood}" aria-label="Food bowl">
            <span class="food-bits"></span>
            <span class="bowl-label">${bowlLabel}</span>
          </div>
          <div class="bowl water-bowl" aria-label="Water bowl">
            <span class="water-fill"></span>
            <span class="bowl-label">${bowlLabel}</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderTaskPanel() {
    if (ui.editingTask) {
      return `
        <section class="ui-panel task-panel">
          <h2 class="panel-title">TASK</h2>
          <form class="edit-form" data-action="save-task">
            <label class="sr-only" for="edit-task">DAILY TASK</label>
            <input id="edit-task" name="dailyTaskText" maxlength="80" value="${escapeHtml(state.dailyTaskText)}" required>
            <div class="edit-actions">
              <button type="submit">SAVE</button>
              <button type="button" data-action="cancel-edit">CANCEL</button>
            </div>
            ${ui.error ? `<div class="form-error">${escapeHtml(ui.error)}</div>` : ""}
          </form>
        </section>
      `;
    }

    return `
      <section class="ui-panel task-panel">
        <h2 class="panel-title">TASK</h2>
        <div class="task-row">
          <input class="check" type="checkbox" id="daily-task-check" data-action="complete-task" ${state.todayTaskCompleted ? "checked disabled" : ""}>
          <label class="task-text" for="daily-task-check">${escapeHtml(state.dailyTaskText)}</label>
          <button class="icon-button" type="button" data-action="edit-task" title="EDIT TASK" aria-label="EDIT TASK"><span class="edit-glyph" aria-hidden="true"></span></button>
        </div>
      </section>
    `;
  }

  function renderAchievementsPanel() {
    const rows = ACHIEVEMENTS.map((achievement, index) => {
      const checked = state.achievementsCheckedToday.includes(index);
      return `
        <div class="achievement-row">
          <input class="check" type="checkbox" id="achievement-${index}" data-action="complete-achievement" data-index="${index}" ${checked ? "checked disabled" : ""}>
          <label class="achievement-text" for="achievement-${index}">${escapeHtml(achievement)}</label>
        </div>
      `;
    }).join("");

    const shelf = state.collectedToys.length
      ? state.collectedToys.map((toyIndex) => renderToyIcon(toyIndex)).join("")
      : Array.from({ length: MAX_HEARTS }, () => '<span class="empty-toy" aria-hidden="true"></span>').join("");

    return `
      <section class="ui-panel achievements-panel">
        <h2 class="panel-title">ACHIEVEMENTS</h2>
        <div class="achievement-list">${rows}</div>
        <h3 class="toy-shelf-title">TOYS</h3>
        <div class="toy-shelf" aria-label="Collected toys">${shelf}</div>
      </section>
    `;
  }

  function renderMeters() {
    return `
      <section class="meters" aria-label="Pet meters">
        <div class="meter">
          <div class="meter-label"><span>HUNGER</span><span>${state.hunger}/5</span></div>
          <div class="hearts" aria-label="Hunger ${state.hunger} out of 5">${renderHearts(state.hunger)}</div>
        </div>
        <div class="meter">
          <div class="meter-label"><span>HAPPINESS</span><span>${state.happiness}/5</span></div>
          <div class="hearts" aria-label="Happiness ${state.happiness} out of 5">${renderHearts(state.happiness)}</div>
        </div>
      </section>
    `;
  }

  function renderOptionsMenu() {
    if (!ui.optionsOpen) {
      return "";
    }

    const resetContent = ui.confirmReset
      ? `
        <div class="menu-section">
          <h3>ARE YOU SURE? YOU’LL LOSE ALL YOUR TOYS.</h3>
          <div class="menu-actions">
            <button type="button" data-action="cancel-reset">CANCEL</button>
            <button class="danger" type="button" data-action="confirm-reset">CONFIRM RESET</button>
          </div>
        </div>
      `
      : `
        <div class="menu-section">
          <h3>RESET</h3>
          <p>WANT TO START OVER? YOU'LL LOSE ALL YOUR TOYS.</p>
          <button class="danger" type="button" data-action="ask-reset">RESET</button>
        </div>
      `;

    return `
      <div class="menu-scrim" role="presentation">
        <section class="menu-dialog" role="dialog" aria-modal="true" aria-label="Options menu">
          <h2>OPTIONS</h2>
          <div class="menu-section">
            <h3>CAT NAP</h3>
            <p>GOING TO BE OOO? PAUSE THE GAME WITH A CAT NAP.</p>
            <button type="button" data-action="toggle-nap">${state.catNapActive ? "WAKE UP" : "CAT NAP"}</button>
          </div>
          ${resetContent}
          <div class="menu-actions">
            <button type="button" data-action="close-options">CLOSE</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderReward() {
    if (!ui.reward) {
      return "";
    }

    if (ui.reward.type === "food") {
      return `
        <div class="reward-pop">
          <div class="reward-card">
            <div class="food-can" aria-hidden="true"><span class="food-can-label">CAT FOOD</span></div>
            <strong>FED!</strong>
          </div>
        </div>
      `;
    }

    const toy = TOYS[ui.reward.toyIndex];
    return `
      <div class="reward-pop">
        <div class="reward-card">
          ${renderToyIcon(ui.reward.toyIndex, "large")}
          <strong>${escapeHtml(toy.name)}</strong>
        </div>
      </div>
    `;
  }

  function renderGame() {
    syncClock();
    const sleepingClass = catVisualState() === "sleeping" ? "is-sleeping" : "";

    app.innerHTML = `
      <main class="app-shell ${sleepingClass}">
        <div class="game-screen">
          <header class="title-block">
            <h1>SCHMACKAGOTCHI</h1>
            <span class="sub-status">${escapeHtml(statusText())}</span>
          </header>
          ${renderRoom()}
          <aside class="side-panel">
            ${renderTaskPanel()}
            ${renderAchievementsPanel()}
          </aside>
          ${renderMeters()}
          <button class="options-button" type="button" data-action="open-options">OPTIONS</button>
          ${renderReward()}
          ${renderOptionsMenu()}
        </div>
      </main>
    `;
  }

  function renderWelcome() {
    app.innerHTML = `
      <main class="welcome-screen">
        <section class="welcome-device">
          <div class="welcome-inner">
            <h1>SCHMACKAGOTCHI</h1>
            <p>WELCOME TO SCHMACKAGOTCHI. MEET YOUR PIXEL WORKDAY CAT.</p>
            <p>NAME YOUR PET, THEN PICK ONE DAILY TASK YOU OFTEN FORGET OR PUT OFF.</p>
            <div class="setup-cat-preview" aria-hidden="true">
              <div class="cat-zone spot-0">
                <div class="cat happy">
                  <span class="cat-tail"></span>
                  <span class="cat-body"></span>
                  <span class="cat-leg left"></span>
                  <span class="cat-leg right"></span>
                  <span class="cat-ear left"></span>
                  <span class="cat-ear right"></span>
                  <span class="cat-head"></span>
                  <span class="cat-eye left"></span>
                  <span class="cat-eye right"></span>
                  <span class="cat-nose"></span>
                  <span class="cat-mouth"></span>
                </div>
              </div>
            </div>
            <form class="setup-form" data-action="start-game">
              <div class="field">
                <label for="pet-name">PET NAME</label>
                <input id="pet-name" name="petName" maxlength="32" autocomplete="off" required>
              </div>
              <div class="field">
                <label for="daily-task">DAILY TASK</label>
                <input id="daily-task" name="dailyTaskText" maxlength="80" autocomplete="off" placeholder="UPDATE TIMESHEETS" required>
              </div>
              ${ui.error ? `<div class="form-error">${escapeHtml(ui.error)}</div>` : ""}
              <button type="submit">START</button>
            </form>
          </div>
        </section>
      </main>
    `;
  }

  function render() {
    if (hasStarted()) {
      renderGame();
    } else {
      renderWelcome();
    }
  }

  app.addEventListener("submit", (event) => {
    const action = event.target.dataset.action;
    if (action === "start-game") {
      startGame(event);
    }
    if (action === "save-task") {
      saveTaskEdit(event);
    }
  });

  app.addEventListener("change", (event) => {
    const action = event.target.dataset.action;
    if (action === "complete-task") {
      completeDailyTask();
    }
    if (action === "complete-achievement") {
      completeAchievement(Number(event.target.dataset.index));
    }
  });

  app.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (action === "edit-task") {
      ui.editingTask = true;
      ui.error = "";
      render();
    }
    if (action === "cancel-edit") {
      ui.editingTask = false;
      ui.error = "";
      render();
    }
    if (action === "open-options") {
      ui.optionsOpen = true;
      ui.confirmReset = false;
      render();
    }
    if (action === "close-options") {
      ui.optionsOpen = false;
      ui.confirmReset = false;
      render();
    }
    if (action === "toggle-nap") {
      toggleCatNap();
    }
    if (action === "ask-reset") {
      ui.confirmReset = true;
      render();
    }
    if (action === "cancel-reset") {
      ui.confirmReset = false;
      render();
    }
    if (action === "confirm-reset") {
      resetGame();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hasStarted()) {
      render();
    }
  });

  window.addEventListener("focus", () => {
    if (hasStarted()) {
      render();
    }
  });

  window.setInterval(() => {
    if (hasStarted()) {
      render();
    }
  }, 60 * 1000);

  render();
})();
