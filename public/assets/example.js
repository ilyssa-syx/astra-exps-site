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
      <label class="sync-speed">Speed
        <select aria-label="Playback speed">
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1" selected>1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
      <input class="sync-progress" type="range" min="0" max="1000" value="0" step="1" aria-label="Video progress">
      <span class="sync-time">00:00.0 / 00:20.0</span>
    </div>
    <p class="measurement-note">Runtime and token count are stage-local, not cumulative. Unattributed iteration token counts are labeled explicitly.</p>
    <div class="baseline-list"></div>`;

  const baselineList = root.querySelector(".baseline-list");
  const baselineToggles = root.querySelector(".baseline-toggles");
  const updateBaselineLayout = () => {
    const visible = Array.from(baselineList.children).filter((section) => !section.hidden).length;
    baselineList.classList.toggle("single-baseline", visible === 1);
  };
  for (const baseline of example.baselines) {
    const completeExportTokens = baseline.exports.every((item) => Number.isFinite(item.token_count));
    const summedExportTokens = baseline.exports.reduce(
      (total, item) => total + (Number.isFinite(item.token_count) ? item.token_count : 0),
      0,
    );
    const totalTokens = Number.isFinite(baseline.total_token_count)
      ? baseline.total_token_count
      : (completeExportTokens ? summedExportTokens : null);
    const totalTokenMarkup = Number.isFinite(totalTokens)
      ? `<footer class="baseline-total">Total: ${totalTokens.toLocaleString("en-US")} tokens${baseline.token_total_note ? `<small>${escapeHtml(baseline.token_total_note)}</small>` : ""}</footer>`
      : `<footer class="baseline-total metric-muted">Total: tokens unreported</footer>`;
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
        <span class="count">${baseline.exports.length} iterations</span>
      </div>
      ${renderAudit(baseline.audit)}
      <div class="iteration-list"></div>
      ${totalTokenMarkup}`;
    const list = section.querySelector(".iteration-list");
    for (const item of baseline.exports) list.appendChild(renderIteration(item));
    const auditToggle = section.querySelector("[data-audit-toggle]");
    const auditTimeline = section.querySelector(".audit-timeline");
    if (auditToggle && auditTimeline) {
      const closedLabel = auditToggle.textContent;
      auditToggle.addEventListener("click", () => {
        auditTimeline.hidden = !auditTimeline.hidden;
        auditToggle.setAttribute("aria-expanded", auditTimeline.hidden ? "false" : "true");
        auditToggle.textContent = auditTimeline.hidden ? closedLabel : "Hide setup";
      });
    }
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
  const video = item.video_url
    ? `<video muted playsinline preload="metadata" data-sync-video><source src="${escapeAttribute(item.video_url)}" type="video/mp4">Your browser does not support MP4 video.</video>`
    : `<div class="video-placeholder">Iteration video pending<br><small>${escapeHtml(item.asset_key)}</small></div>`;
  const provenance = item.provenance
    ? `<details class="iteration-provenance"><summary>Raw provenance</summary><pre>${escapeHtml(JSON.stringify(item.provenance, null, 2))}</pre></details>`
    : "";
  const auditEvents = item.audit_events || [];
  const auditEntryCount = collapseAuditEvents(auditEvents).length;
  const auditLabel = `Audit (${auditEntryCount} entries · ${auditEvents.length} events)`;
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
        <button type="button" data-details-toggle aria-expanded="false">${auditLabel}</button>
      </div>
    </header>
    <p class="iteration-reason"><strong>Recorded reason:</strong> ${escapeHtml(item.reason || "No reason recorded")}</p>
    ${provenance}
    <div class="video-frame">${video}</div>
    <div class="iteration-details" hidden>${renderAuditEvents(auditEvents)}</div>`;

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
    detailsToggle.textContent = details.hidden
      ? auditLabel
      : "Hide audit";
  });

  return article;
}

function renderAudit(audit) {
  if (!audit || !audit.available) {
    return `<section class="audit-panel audit-unavailable">
      <h3>Audit timeline</h3>
      <p>No <code>audit/events.jsonl</code> is available for this baseline.</p>
    </section>`;
  }
  const events = audit.setup_events || [];
  const entryCount = collapseAuditEvents(events).length;
  return `<section class="audit-panel">
    <div class="audit-heading">
      <div>
        <h3>Run audit</h3>
        <p>${audit.included_event_count || 0} source events from <code>${escapeHtml(audit.source)}</code>; ${audit.excluded_event_count || 0} token-usage/time-limit check events excluded.</p>
      </div>
      <button type="button" data-audit-toggle aria-expanded="false">Setup (${entryCount} entries · ${events.length} events)</button>
    </div>
    <ol class="audit-timeline" hidden>${renderAuditEventList(events)}</ol>
  </section>`;
}

function renderAuditEvents(events) {
  if (!events.length) return `<p class="audit-empty">No audit events were assigned to this iteration.</p>`;
  return `<ol class="audit-timeline iteration-audit">${renderAuditEventList(events)}</ol>`;
}

function renderAuditEventList(events) {
  return collapseAuditEvents(events).map(renderAuditEntry).join("");
}

function collapseAuditEvents(events) {
  const entries = [];
  const callsById = new Map();
  events.forEach((exported) => {
    const event = exported.raw || exported;
    const payload = event.payload || {};
    const isToolCall = event.event === "tool_call_started" || event.event === "tool_call_finished";
    if (!isToolCall || !payload.call_id) {
      entries.push({ kind: "event", exported });
      return;
    }
    let entry = callsById.get(payload.call_id);
    if (!entry) {
      entry = { kind: "tool-call", callId: payload.call_id, started: null, finished: null };
      callsById.set(payload.call_id, entry);
      entries.push(entry);
    }
    if (event.event === "tool_call_started") entry.started = exported;
    if (event.event === "tool_call_finished") entry.finished = exported;
  });
  return entries;
}

function isPatchOperation(payload) {
  const tool = String(payload.tool || "").toLowerCase().replaceAll("-", "_");
  const operation = String(payload.operation || "").toLowerCase().replaceAll("-", "_");
  return tool === "apply_patch" || operation === "apply_patch" || operation === "apply_script";
}

function renderAuditEntry(entry) {
  return entry.kind === "tool-call" ? renderToolCall(entry) : renderAuditEvent(entry.exported);
}

function renderToolCall(entry) {
  const startedEvent = entry.started ? (entry.started.raw || entry.started) : null;
  const finishedEvent = entry.finished ? (entry.finished.raw || entry.finished) : null;
  const startedPayload = startedEvent ? (startedEvent.payload || {}) : {};
  const finishedPayload = finishedEvent ? (finishedEvent.payload || {}) : {};
  const displayPayload = startedEvent ? startedPayload : finishedPayload;
  const toolOperation = [displayPayload.tool, displayPayload.operation].filter(Boolean).join(" · ");
  const title = toolOperation || `tool call ${entry.callId}`;
  const isReusedTool = Boolean(startedEvent) && !isPatchOperation(startedPayload);
  const reusedToolBadge = isReusedTool
    ? `<span class="audit-tool-badge">reused tool</span>`
    : "";
  const incompleteLabel = !startedEvent
    ? `<span class="audit-state-badge">missing start</span>`
    : !finishedEvent
      ? `<span class="audit-state-badge">unfinished</span>`
      : "";
  const purpose = startedPayload.purpose
    ? `<p class="audit-purpose">${escapeHtml(startedPayload.purpose)}</p>`
    : "";
  const exitCode = Number.isInteger(finishedPayload.exit_code)
    ? `<span class="audit-exit ${finishedPayload.exit_code === 0 ? "audit-ok" : "audit-failed"}">exit ${finishedPayload.exit_code}</span>`
    : "";
  const elapsed = Number.isFinite(finishedPayload.elapsed_seconds)
    ? `<span>${formatPreciseDuration(finishedPayload.elapsed_seconds)}</span>`
    : "";
  const timestamp = startedEvent ? startedEvent.created_at : finishedEvent && finishedEvent.created_at;
  const time = Number.isFinite(timestamp)
    ? `<time datetime="${new Date(timestamp * 1000).toISOString()}">${escapeHtml(formatAuditTime(timestamp))}</time>`
    : "";
  const startSequence = startedEvent && startedEvent.sequence;
  const finishSequence = finishedEvent && finishedEvent.sequence;
  const sequence = startSequence && finishSequence && startSequence !== finishSequence
    ? `#${startSequence}–#${finishSequence}`
    : `#${startSequence || finishSequence || "?"}`;
  const classes = [
    "audit-event",
    "audit-event-tool-call",
    isReusedTool ? "audit-event-reused-tool" : "",
    !startedEvent || !finishedEvent ? "audit-event-incomplete" : "",
  ].filter(Boolean).join(" ");
  const rawStarted = startedEvent ? renderJsonDetails("Raw started event", startedEvent) : "";
  const rawFinished = finishedEvent ? renderJsonDetails("Raw finished event", finishedEvent) : "";
  const request = entry.started && entry.started.request
    ? renderJsonDetails("Raw tool request", entry.started.request)
    : "";
  const result = entry.finished && entry.finished.result
    ? renderJsonDetails("Raw tool result", entry.finished.result)
    : "";

  return `<li class="${classes}">
    <div class="audit-event-summary">
      <span class="audit-sequence">${escapeHtml(sequence)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${reusedToolBadge}
        ${incompleteLabel}
        <span class="audit-event-type">tool call</span>
        ${purpose}
        <div class="audit-meta">${time}${elapsed}${exitCode}</div>
      </div>
    </div>
    ${rawStarted}
    ${rawFinished}
    ${request}
    ${result}
  </li>`;
}

function renderAuditEvent(exported) {
  const event = exported.raw || exported;
  const payload = event.payload || {};
  const toolOperation = [payload.tool, payload.operation].filter(Boolean).join(" · ");
  const title = toolOperation || event.event || "audit event";
  const purpose = payload.purpose ? `<p class="audit-purpose">${escapeHtml(payload.purpose)}</p>` : "";
  const exitCode = Number.isInteger(payload.exit_code)
    ? `<span class="audit-exit ${payload.exit_code === 0 ? "audit-ok" : "audit-failed"}">exit ${payload.exit_code}</span>`
    : "";
  const elapsed = Number.isFinite(payload.elapsed_seconds)
    ? `<span>${formatPreciseDuration(payload.elapsed_seconds)}</span>`
    : "";
  const time = Number.isFinite(event.created_at)
    ? `<time datetime="${new Date(event.created_at * 1000).toISOString()}">${escapeHtml(formatAuditTime(event.created_at))}</time>`
    : "";
  const request = exported.request
    ? renderJsonDetails("Raw tool request", exported.request)
    : "";
  const result = exported.result
    ? renderJsonDetails("Raw tool result", exported.result)
    : "";
  return `<li class="audit-event">
    <div class="audit-event-summary">
      <span class="audit-sequence">#${escapeHtml(event.sequence)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span class="audit-event-type">${escapeHtml(event.event)}</span>
        ${purpose}
        <div class="audit-meta">${time}${elapsed}${exitCode}</div>
      </div>
    </div>
    <details>
      <summary>Raw event JSON</summary>
      <pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre>
    </details>
    ${request}
    ${result}
  </li>`;
}

function renderJsonDetails(label, value) {
  return `<details><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`;
}

function formatAuditTime(epochSeconds) {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function formatPreciseDuration(seconds) {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  return formatDuration(seconds);
}

function createSyncController(panel) {
  const playButton = panel.querySelector(".sync-play");
  const speed = panel.querySelector(".sync-speed select");
  const progress = panel.querySelector(".sync-progress");
  const time = panel.querySelector(".sync-time");
  const videos = Array.from(panel.querySelectorAll("video[data-sync-video]"));
  let playing = false;
  let duration = 20;
  let currentTime = 0;
  let animationFrame = null;

  function applyPlaybackRate() {
    const rate = Number(speed.value);
    for (const video of videos) video.playbackRate = rate;
  }

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
    applyPlaybackRate();
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
  speed.addEventListener("change", applyPlaybackRate);
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
  applyPlaybackRate();
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
  node.textContent = value === undefined || value === null ? "" : String(value);
  return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
