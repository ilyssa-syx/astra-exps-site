(async function () {
  const root = document.querySelector("#example-root");
  const exampleId = document.body.dataset.example;
  try {
    const response = await fetch("../../data/catalog.json");
    if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
    const catalog = await response.json();
    const example = catalog.examples.find((item) => item.id === exampleId);
    if (!example) throw new Error(`unknown example: ${exampleId}`);
    document.title = `${example.title} · ${catalog.site_title}`;
    renderExample(root, example, Boolean(catalog.asset_base_url));
  } catch (error) {
    root.innerHTML = `<p class="error">Could not load this experiment.</p>`;
    console.error(error);
  }
})();

function renderExample(root, example, assetsReady) {
  root.innerHTML = `
    <section class="example-hero">
      <a class="back-link" href="../../">← All examples</a>
      <p class="eyebrow">Example / ${escapeHtml(example.id)}</p>
      <h1>${escapeHtml(example.title)}</h1>
      <p class="lede">${escapeHtml(example.description)}</p>
    </section>
    <nav class="baseline-tabs" aria-label="Baselines"></nav>
    <section class="baseline-panel"></section>`;

  const tabs = root.querySelector(".baseline-tabs");
  const panel = root.querySelector(".baseline-panel");
  const requested = new URLSearchParams(window.location.search).get("baseline");
  let active = example.baselines.find((item) => item.id === requested) || example.baselines[0];
  let syncController = null;

  for (const baseline of example.baselines) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "baseline-tab";
    button.textContent = baseline.label;
    button.addEventListener("click", () => {
      active = baseline;
      const url = new URL(window.location.href);
      url.searchParams.set("baseline", baseline.id);
      window.history.replaceState({}, "", url);
      update();
    });
    button.dataset.baseline = baseline.id;
    tabs.appendChild(button);
  }

  function update() {
    if (syncController) syncController.destroy();
    for (const button of tabs.querySelectorAll("button")) {
      const selected = button.dataset.baseline === active.id;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    panel.innerHTML = `
      <div class="baseline-intro">
        <div>
          <p class="eyebrow">Baseline</p>
          <h2>${escapeHtml(active.label)}</h2>
          <p>${escapeHtml(active.summary)}</p>
        </div>
        <span class="count">${active.exports.length} RGB videos</span>
      </div>
      ${!assetsReady ? `<div class="notice"><strong>Video assets pending.</strong></div>` : ""}
      <div class="sync-controls" aria-label="Synchronized video controls">
        <button class="sync-play" type="button">Play all</button>
        <input class="sync-progress" type="range" min="0" max="1000" value="0" step="1" aria-label="Video progress">
        <span class="sync-time">00:00.0 / 00:20.0</span>
      </div>
      <div class="iteration-list"></div>`;
    const list = panel.querySelector(".iteration-list");
    for (const item of active.exports) list.appendChild(renderIteration(item));
    syncController = createSyncController(panel);
  }

  update();
}

function renderIteration(item) {
  const article = document.createElement("article");
  article.className = "iteration-row";
  const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
  const toolTags = item.tools.map((tool) => `<li>${escapeHtml(tool)}</li>`).join("");
  const video = item.video_url
    ? `<video muted playsinline preload="metadata" data-sync-video><source src="${escapeAttribute(item.video_url)}" type="video/mp4">Your browser does not support MP4 video.</video>`
    : `<div class="video-placeholder">R2 asset pending<br><small>${escapeHtml(item.asset_key)}</small></div>`;
  article.innerHTML = `
    <header class="iteration-heading">
      <div>
        <h3>${escapeHtml(item.label)}</h3>
        <span class="status status-${escapeAttribute(item.status)}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="row-actions">
        <button type="button" data-video-toggle>Hide RGB</button>
        <button type="button" data-details-toggle aria-expanded="false">RGB details</button>
      </div>
    </header>
    <div class="video-frame">${video}</div>
    <div class="iteration-details" hidden>
      <section><h4>Tools</h4><ul>${toolTags}</ul></section>
      <section><h4>Change</h4><p>${escapeHtml(item.change)}</p></section>
      <section><h4>Conclusion</h4><p>${escapeHtml(item.conclusion)}</p></section>
    </div>`;

  const frame = article.querySelector(".video-frame");
  const videoToggle = article.querySelector("[data-video-toggle]");
  videoToggle.addEventListener("click", () => {
    const wasHidden = frame.hidden;
    frame.hidden = !wasHidden;
    videoToggle.textContent = wasHidden ? "Hide RGB" : "Show RGB";
    article.dispatchEvent(new CustomEvent("visibilitychange", { bubbles: true }));
  });

  const details = article.querySelector(".iteration-details");
  const detailsToggle = article.querySelector("[data-details-toggle]");
  detailsToggle.addEventListener("click", () => {
    details.hidden = !details.hidden;
    detailsToggle.setAttribute("aria-expanded", details.hidden ? "false" : "true");
    detailsToggle.textContent = details.hidden ? "RGB details" : "Hide details";
  });
  return article;
}

function createSyncController(panel) {
  const playButton = panel.querySelector(".sync-play");
  const progress = panel.querySelector(".sync-progress");
  const time = panel.querySelector(".sync-time");
  const videos = Array.from(panel.querySelectorAll("video[data-sync-video]"));
  let playing = false;
  let duration = 20;
  let currentTime = 0;
  let animationFrame = null;

  const visibleVideos = () => videos.filter((video) => !video.closest(".video-frame").hidden);
  const leader = () => visibleVideos()[0] || null;

  function updateDuration() {
    const finite = videos.map((video) => video.duration).filter(Number.isFinite);
    if (finite.length) duration = Math.min(...finite);
    paint();
  }

  function paint() {
    const active = leader();
    if (active && Number.isFinite(active.currentTime)) currentTime = active.currentTime;
    progress.value = duration ? Math.round((currentTime / duration) * 1000) : 0;
    time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  }

  function synchronize() {
    const active = visibleVideos();
    const first = active[0];
    if (!first) return;
    currentTime = first.currentTime;
    for (const video of active.slice(1)) {
      if (Math.abs(video.currentTime - currentTime) > 0.08) video.currentTime = currentTime;
    }
  }

  function tick() {
    if (!playing) return;
    synchronize();
    paint();
    animationFrame = requestAnimationFrame(tick);
  }

  async function playAll() {
    const active = visibleVideos();
    if (!active.length) return;
    for (const video of active) video.currentTime = currentTime;
    await Promise.all(active.map((video) => video.play().catch(() => null)));
    playing = true;
    playButton.textContent = "Pause all";
    cancelAnimationFrame(animationFrame);
    tick();
  }

  function pauseAll() {
    for (const video of videos) video.pause();
    playing = false;
    playButton.textContent = "Play all";
    cancelAnimationFrame(animationFrame);
    paint();
  }

  playButton.addEventListener("click", () => playing ? pauseAll() : playAll());
  progress.addEventListener("input", () => {
    currentTime = duration * Number(progress.value) / 1000;
    for (const video of visibleVideos()) video.currentTime = currentTime;
    paint();
  });
  for (const video of videos) {
    video.addEventListener("loadedmetadata", updateDuration);
    video.addEventListener("ended", pauseAll);
  }
  panel.addEventListener("visibilitychange", (event) => {
    const video = event.target.querySelector("video");
    if (!video) return;
    if (video.closest(".video-frame").hidden) {
      video.pause();
    } else {
      video.currentTime = currentTime;
      if (playing) video.play().catch(() => null);
    }
    paint();
  });
  paint();

  return {
    destroy() {
      pauseAll();
    },
  };
}

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const remainder = (value % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value || "";
  return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

