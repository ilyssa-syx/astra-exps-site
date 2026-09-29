(async function () {
  const root = document.querySelector("#example-root");
  const exampleId = document.body.dataset.example;
  const assetVersion = document.body.dataset.assetVersion || "1";
  try {
    const response = await fetch(`../../data/catalog.json?v=${encodeURIComponent(assetVersion)}`);
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
    <nav class="baseline-toggles" aria-label="Show or hide baselines"></nav>
    ${!assetsReady ? `<div class="notice"><strong>Video assets pending.</strong></div>` : ""}
    <div class="sync-controls" aria-label="Synchronized video controls">
      <button class="sync-play" type="button">Play all</button>
      <input class="sync-progress" type="range" min="0" max="1000" value="0" step="1" aria-label="Video progress">
      <span class="sync-time">00:00.0 / 00:20.0</span>
    </div>
    <p class="measurement-note">Runtime and token count are for that stage only, not cumulative. Unreported token counts are labeled explicitly.</p>
    <div class="baseline-list"></div>`;

  const baselineList = root.querySelector(".baseline-list");
  const baselineToggles = root.querySelector(".baseline-toggles");
  const updateBaselineLayout = () => {
    const visible = Array.from(baselineList.children).filter((section) => !section.hidden).length;
    baselineList.classList.toggle("single-baseline", visible === 1);
  };
  for (const baseline of example.baselines) {
    const section = document.createElement("section");
    section.className = "baseline-section";
    section.dataset.baseline = baseline.id;
    section.innerHTML = `
      <div class="baseline-intro">
        <div>
          <p class="eyebrow">Baseline</p>
          <h2>${escapeHtml(baseline.label)}</h2>
          <p>${escapeHtml(baseline.summary)}</p>
        </div>
        <span class="count">${baseline.exports.length} RGB videos</span>
      </div>
      <div class="iteration-list"></div>`;
    const list = section.querySelector(".iteration-list");
    for (const item of baseline.exports) list.appendChild(renderIteration(item));
    baselineList.appendChild(section);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "baseline-toggle is-active";
    toggle.textContent = baseline.label;
    toggle.setAttribute("aria-pressed", "true");
    toggle.addEventListener("click", () => {
      const willShow = section.hidden;
      section.hidden = !willShow;
      toggle.classList.toggle("is-active", willShow);
      toggle.setAttribute("aria-pressed", willShow ? "true" : "false");
      section.dispatchEvent(new CustomEvent("visibilitychange", { bubbles: true }));
      updateBaselineLayout();
    });
    baselineToggles.appendChild(toggle);
  }
  updateBaselineLayout();
  createSyncController(root);
}

function renderIteration(item) {
  const article = document.createElement("article");
  article.className = "iteration-row";
  const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
  const runtime = Number.isFinite(item.runtime_seconds)
    ? `<span class="metric">Runtime ${formatDuration(item.runtime_seconds)}</span>`
    : "";
  const tokens = Number.isFinite(item.token_count)
    ? `<span class="metric">${item.token_count.toLocaleString("en-US")} tokens</span>`
    : (item.token_note ? `<span class="metric metric-muted">${escapeHtml(item.token_note)}</span>` : "");
  const toolTags = item.tools.map((tool) => `<li>${escapeHtml(tool)}</li>`).join("");
  const video = item.video_url
    ? `<video muted playsinline preload="metadata" data-sync-video><source src="${escapeAttribute(item.video_url)}" type="video/mp4">Your browser does not support MP4 video.</video>`
    : `<div class="video-placeholder">R2 asset pending<br><small>${escapeHtml(item.asset_key)}</small></div>`;
  article.innerHTML = `
    <header class="iteration-heading">
      <div>
        <h3>${escapeHtml(item.label)}</h3>
        <span class="status status-${escapeAttribute(item.status)}">${escapeHtml(statusLabel)}</span>
        ${runtime}
        ${tokens}
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

  const visibleVideos = () => videos.filter((video) => (
    !video.closest(".video-frame").hidden && !video.closest(".baseline-section").hidden
  ));
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
    const affected = Array.from(event.target.querySelectorAll("video"));
    for (const video of affected) {
      const hidden = video.closest(".video-frame").hidden || video.closest(".baseline-section").hidden;
      if (hidden) {
        video.pause();
      } else {
        video.currentTime = currentTime;
        if (playing) video.play().catch(() => null);
      }
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

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value || "";
  return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
