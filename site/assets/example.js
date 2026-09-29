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
      <p class="eyebrow">EXAMPLE / ${escapeHtml(example.id)}</p>
      <h1>${escapeHtml(example.title)}</h1>
      <p class="lede">${escapeHtml(example.description)}</p>
    </section>
    <nav class="baseline-tabs" aria-label="Baselines"></nav>
    <section class="baseline-panel"></section>`;

  const tabs = root.querySelector(".baseline-tabs");
  const panel = root.querySelector(".baseline-panel");
  const requested = new URLSearchParams(window.location.search).get("baseline");
  let active = example.baselines.find((item) => item.id === requested) || example.baselines[0];

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
    for (const button of tabs.querySelectorAll("button")) {
      const selected = button.dataset.baseline === active.id;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    panel.innerHTML = `
      <div class="baseline-intro">
        <div>
          <p class="eyebrow">BASELINE</p>
          <h2>${escapeHtml(active.label)}</h2>
          <p>${escapeHtml(active.summary)}</p>
        </div>
        <span class="count">${active.exports.length} exported iterations</span>
      </div>
      ${!assetsReady ? `<div class="notice"><strong>Video assets pending.</strong> The iteration record is ready; configure the R2 public URL to enable playback.</div>` : ""}
      <div class="iteration-list"></div>`;
    const list = panel.querySelector(".iteration-list");
    for (const item of active.exports) list.appendChild(renderIteration(item));
  }

  update();
}

function renderIteration(item) {
  const article = document.createElement("article");
  article.className = "iteration-card";
  const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
  const toolTags = item.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join("");
  const video = item.video_url
    ? `<video controls playsinline preload="metadata"><source src="${escapeAttribute(item.video_url)}" type="video/mp4">Your browser does not support MP4 video.</video>`
    : `<div class="video-placeholder"><span>R2 asset pending</span><code>${escapeHtml(item.asset_key)}</code></div>`;
  article.innerHTML = `
    <header class="iteration-heading">
      <div>
        <p class="eyebrow">ITERATION ${String(item.iteration).padStart(2, "0")}</p>
        <h3>${escapeHtml(item.variant)}</h3>
      </div>
      <span class="status status-${escapeAttribute(item.status)}">${escapeHtml(statusLabel)}</span>
    </header>
    <div class="video-frame">${video}</div>
    <div class="iteration-notes">
      <div class="note-block">
        <h4>Key tools</h4>
        <div class="tool-list">${toolTags}</div>
      </div>
      <div class="note-block">
        <h4>Change</h4>
        <p>${escapeHtml(item.change)}</p>
      </div>
      <div class="note-block conclusion">
        <h4>Conclusion</h4>
        <p>${escapeHtml(item.conclusion)}</p>
      </div>
    </div>`;
  return article;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value || "";
  return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

