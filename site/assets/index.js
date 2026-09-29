(async function () {
  const grid = document.querySelector("#example-grid");
  const count = document.querySelector("#example-count");
  try {
    const response = await fetch("data/catalog.json");
    if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
    const catalog = await response.json();
    count.textContent = `${catalog.examples.length} total`;
    grid.innerHTML = "";
    for (const example of catalog.examples) {
      const link = document.createElement("a");
      link.className = "example-card";
      link.href = `examples/${encodeURIComponent(example.id)}/`;
      const exports = example.baselines.reduce((sum, item) => sum + item.exports.length, 0);
      link.innerHTML = `
        <span class="example-index">${String(grid.children.length + 1).padStart(2, "0")}</span>
        <div>
          <h3>${escapeHtml(example.title)}</h3>
          <p>${escapeHtml(example.description)}</p>
        </div>
        <div class="example-meta">
          <span>${example.baselines.length} baseline${example.baselines.length === 1 ? "" : "s"}</span>
          <span>${exports} iterations</span>
        </div>`;
      grid.appendChild(link);
    }
  } catch (error) {
    grid.innerHTML = `<p class="error">Could not load the experiment catalog.</p>`;
    console.error(error);
  }
})();

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value || "";
  return node.innerHTML;
}

