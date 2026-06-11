// Author= Akash Deep

const data = pm.response.json();

if (!data || !data.issues) {
    console.log("Invalid response:", data);
    return;
}

// =======================
// CONSTANTS
// =======================
const invalidResolutions = new Set([
    "Duplicate",
    "Abandoned",
    "Not a bug",
    "Cannot Reproduce",
    "Won't Do"
]);

// =======================
// GROUP ISSUES BY PROJECT
// =======================
// key → { name, issues[] }
const projectMap = {};

data.issues.forEach(issue => {
    const proj = issue.fields?.project;
    if (!proj) return;
    const key = proj.key || "UNKNOWN";
    const name = proj.name || key;
    if (!projectMap[key]) projectMap[key] = { name, issues: [] };
    projectMap[key].issues.push(issue);
});

// =======================
// PROCESS ONE PROJECT
// =======================
function processProject(issues) {

    let invalidBugs = 0, invalidByResolution = {}, validBugs = 0;
    let priorityCount = {}, bugCauseCount = {}, testingActivityCount = {}, envCombinationCount = {};
    let bugsWithStories = 0, bugsWithInProgressStories = 0;
    let uniqueStories = new Set(), uniqueInProgressStories = new Set();
    let unlinkedBugs = 0;
    let criticalBugs = [], highBugs = [], mediumBugs = [], lowBugs = [];

    issues.forEach(issue => {
        const fields = issue.fields || {};

        // --- INVALID CHECK ---
        const resolution = fields.resolution?.name || "Unresolved";

        const isInvalid = invalidResolutions.has(resolution);

        if (isInvalid) {
            invalidBugs++;

            invalidByResolution[resolution] =
                (invalidByResolution[resolution] || 0) + 1;

            return;
        }
        validBugs++;

        // --- PRIORITY ---
        const priority = fields.priority?.name || "Unknown";

        priorityCount[priority] =
            (priorityCount[priority] || 0) + 1;

        // -------------------
        // BUG CAUSE
        // -------------------
        const bugCauseArr = Array.isArray(fields.customfield_10166)
            ? fields.customfield_10166
            : fields.customfield_10166
                ? [fields.customfield_10166]
                : [];

        if (bugCauseArr.length === 0) {
            bugCauseCount["N/A"] = (bugCauseCount["N/A"] || 0) + 1;
        } else {
            let hasValue = false;

            bugCauseArr.forEach(c => {
                if (c?.value) {
                    hasValue = true;
                    bugCauseCount[c.value] =
                        (bugCauseCount[c.value] || 0) + 1;
                }
            });

            if (!hasValue) {
                bugCauseCount["N/A"] = (bugCauseCount["N/A"] || 0) + 1;
            }
        }

        // -------------------
        // TESTING ACTIVITY
        // -------------------
        const testingArr = Array.isArray(fields.customfield_10747)
            ? fields.customfield_10747
            : fields.customfield_10747
                ? [fields.customfield_10747]
                : [];

        if (testingArr.length === 0) {
            testingActivityCount["N/A"] =
                (testingActivityCount["N/A"] || 0) + 1;
        } else {
            let hasValue = false;

            testingArr.forEach(t => {
                if (t?.value) {
                    hasValue = true;
                    testingActivityCount[t.value] =
                        (testingActivityCount[t.value] || 0) + 1;
                }
            });

            if (!hasValue) {
                testingActivityCount["N/A"] =
                    (testingActivityCount["N/A"] || 0) + 1;
            }
        }

        // -------------------
        // ENVIRONMENT
        // -------------------
        const envValues = (fields.customfield_10750 || [])
            .map(x => x.value)
            .filter(Boolean);

        if (!envValues || envValues.length === 0) {
            envCombinationCount["None"] =
                (envCombinationCount["None"] || 0) + 1;
        } else {
            const comboKey = [...new Set(envValues)]
                .sort()
                .join(" / ");

            envCombinationCount[comboKey] =
                (envCombinationCount[comboKey] || 0) + 1;
        }

        // -------------------
        // USER STORIES
        // -------------------
        const links = fields.issuelinks || [];

        let bugHasStory = false;
        let bugHasInProgressStory = false;

        links.forEach(link => {

            if (link.type?.inward !== "Testing discovered") {
                return;
            }

            const linked =
                link.outwardIssue ||
                link.inwardIssue;

            if (!linked?.key) {
                return;
            }

            const issueType =
                linked.fields?.issuetype?.name || "";

            if (
                issueType !== "Story" &&
                issueType !== "Task"
            ) {
                return;
            }

            bugHasStory = true;

            uniqueStories.add(linked.key);

            const status =
                linked.fields?.status?.name || "";

            const isInProgress =
                !["Done", "Closed", "Resolved"]
                    .includes(status);

            if (isInProgress) {
                bugHasInProgressStory = true;
                uniqueInProgressStories.add(linked.key);
            }
        });

        if (bugHasStory) bugsWithStories++;
        if (bugHasInProgressStory) bugsWithInProgressStories++;
        if (!bugHasStory) unlinkedBugs++;

        // -------------------
        // CRITICAL / HIGH / MEDIUM / LOW BUGS
        // (pushed AFTER bugHasStory is resolved)
        // -------------------
        const summary = fields.summary || "";
        const priorityLower = priority.toLowerCase();

        if (priorityLower === "critical") {
            criticalBugs.push({ summary, hasStory: bugHasStory });
        }

        if (priorityLower === "high") {
            highBugs.push({ summary, hasStory: bugHasStory });
        }

        if (priorityLower === "medium") {
            mediumBugs.push({ summary, hasStory: bugHasStory });
        }

        if (priorityLower === "low") {
            lowBugs.push({ summary, hasStory: bugHasStory });
        }
    });

    return {
        invalidBugs, invalidByResolution, validBugs,
        priorityCount, bugCauseCount, testingActivityCount, envCombinationCount,
        bugsWithStories, bugsWithInProgressStories,
        uniqueStories, uniqueInProgressStories, unlinkedBugs,
        criticalBugs, highBugs, mediumBugs, lowBugs
    };
}

// =======================
// HELPERS
// =======================
function format(obj) {
    return Object.entries(obj || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
}

// =======================
// REUSABLE: BUILD PRIORITY BUG TEXT BLOCK
// =======================
function buildPriorityBugText(bugs, label) {
    if (!bugs || bugs.length === 0) return "";

    const linked = bugs.filter(b => b.hasStory);
    const unlinked = bugs.filter(b => !b.hasStory);
    let text = "";

    if (linked.length > 0) {
        const plural = linked.length > 1;
        text += `&nbsp;&nbsp;<b>${linked.length} ${label} bug${plural ? 's' : ''} ${plural ? 'were' : 'was'} directly linked to user stor${plural ? 'ies' : 'y'}:</b><br>`;
        linked.forEach(b => {
            text += `&nbsp;&nbsp;&nbsp;&nbsp;• ${b.summary}<br>`;
        });
        text += "<br>";
    }

    if (unlinked.length > 0) {
        const plural = unlinked.length > 1;
        text += `&nbsp;&nbsp;<b>${unlinked.length} ${label} bug${plural ? 's' : ''} ${plural ? 'were' : 'was'} not linked to any user stor${plural ? 'ies' : 'y'}:</b><br>`;
        unlinked.forEach(b => {
            text += `&nbsp;&nbsp;&nbsp;&nbsp;• ${b.summary}<br>`;
        });
        text += "<br>";
    }

    return text;
}

// =======================
// BUILD DASHBOARD HTML
// =======================
function buildDashboard(projectName, d) {

    const invalidSummary =
        Object.entries(d.invalidByResolution)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") || "None";

    const allStoriesList =
        Array.from(d.uniqueStories).join(", ") || "None";

    const inProgressStoriesList =
        Array.from(d.uniqueInProgressStories).join(", ") || "None";

    const criticalText = buildPriorityBugText(d.criticalBugs, "Critical");
    const highText     = buildPriorityBugText(d.highBugs,     "High");

    // -------------------
    // LOW / MEDIUM — zero-padded single-line format
    // -------------------
    function pad(n) { return String(n).padStart(2, '0'); }

    const lowLinked      = d.lowBugs.filter(b => b.hasStory).length;
    const lowUnlinked    = d.lowBugs.filter(b => !b.hasStory).length;
    const mediumLinked   = d.mediumBugs.filter(b => b.hasStory).length;
    const mediumUnlinked = d.mediumBugs.filter(b => !b.hasStory).length;

    // Build optional sub-note lines — only show a part if count > 0
    const lowLinkedLine   = lowLinked   > 0 ? `<span class="note-line">↳ ${pad(lowLinked)} Low bug${lowLinked !== 1 ? 's' : ''} were related to user stories</span>` : "";
    const lowUnlinkedLine = lowUnlinked > 0 ? `<span class="note-line">↳ ${pad(lowUnlinked)} Low bug${lowUnlinked !== 1 ? 's' : ''} were unparented</span>` : "";
    const medLinkedLine   = mediumLinked   > 0 ? `<span class="note-line">↳ ${pad(mediumLinked)} Medium bug${mediumLinked !== 1 ? 's' : ''} were related to user stories</span>` : "";
    const medUnlinkedLine = mediumUnlinked > 0 ? `<span class="note-line">↳ ${pad(mediumUnlinked)} Medium bug${mediumUnlinked !== 1 ? 's' : ''} were unparented</span>` : "";

    const lowBlock = (lowLinkedLine || lowUnlinkedLine)
        ? `<span class="note-header">${pad(d.lowBugs.length)} Low bug${d.lowBugs.length !== 1 ? 's' : ''} were reported</span>${lowLinkedLine}${lowUnlinkedLine}`
        : "";

    const mediumBlock = (medLinkedLine || medUnlinkedLine)
        ? `<span class="note-header">${pad(d.mediumBugs.length)} Medium bug${d.mediumBugs.length !== 1 ? 's' : ''} were reported</span>${medLinkedLine}${medUnlinkedLine}`
        : "";

    // -------------------
    // SUMMARY TEXT
    // -------------------
    const summaryText = `
<b>Insights Bug Summary:</b><br><br>

Out of <b>${d.validBugs}</b> total reported bug${d.validBugs > 1 ? 's' : ''}
(<b class="valid-count">${d.validBugs} Valid</b> / <b class="invalid-count">${d.invalidBugs} Invalid</b>),
<b>${d.bugsWithStories}</b> bug${d.bugsWithStories > 1 ? 's' : ''} ${d.bugsWithStories > 1 ? 'were' : 'was'} associated with
<b>${d.uniqueStories.size}</b> User Stor${d.uniqueStories.size > 1 ? 'ies' : 'y'} and
<b>${d.unlinkedBugs}</b> bug${d.unlinkedBugs > 1 ? 's' : ''} ${d.unlinkedBugs > 1 ? 'were' : 'was'} identified during regression testing that ${d.unlinkedBugs > 1 ? 'are' : 'is'} not associated with any user story.<br><br>

${criticalText}

${highText}

${(lowBlock || mediumBlock) ? `<div class="notes-block">${lowBlock}${mediumBlock}</div>` : ""}

${d.invalidBugs} Additional bug${d.invalidBugs > 1 ? 's' : ''} ${d.invalidBugs > 1 ? 'were' : 'was'} logged but later marked as ${invalidSummary}<br><br>

Out of total ${d.validBugs} bug${d.validBugs > 1 ? 's' : ''},
${d.bugsWithInProgressStories} bug${d.bugsWithInProgressStories > 1 ? 's' : ''} ${d.bugsWithInProgressStories > 1 ? 'were' : 'was'} tied to
${d.uniqueInProgressStories.size} In Progress User Stor${d.uniqueInProgressStories.size > 1 ? 'ies' : 'y'}.<br><br>
<b>Testing Activity:</b> ${format(d.testingActivityCount)}<br>
<b>Bug Cause:</b> ${format(d.bugCauseCount)}<br>
<b>Environment Bug Found:</b> ${format(d.envCombinationCount)}<br><br>
`;

    return `
<div class="header">
  <div class="badge">Monthly Report</div>
  <h1>${projectName}</h1>
  <div class="meta">Bugs Data</div>
</div>

<div class="kpi-row">
  <div class="kpi valid">
    <div class="kpi-num">${d.validBugs}</div>
    <div class="kpi-label">Valid Bugs</div>
  </div>
  <div class="kpi invalid">
    <div class="kpi-num">${d.invalidBugs}</div>
    <div class="kpi-label">Invalid Bugs</div>
  </div>
  <div class="kpi unparented">
    <div class="kpi-num">${d.unlinkedBugs}</div>
    <div class="kpi-label">Unparented Bugs</div>
    <div class="kpi-sub">Not linked to any user story</div>
  </div>
</div>

<div class="grid-4">

  <div class="card">
    <div class="card-head"><div class="card-icon icon-teal">⚡</div><div class="card-title">Priority</div></div>
    <table>
      <tr><th>Type</th><th>Count</th></tr>
      ${Object.entries(d.priorityCount).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
      <tr class="total-row"><td>Total</td><td>${Object.values(d.priorityCount).reduce((a, b) => a + b, 0)}</td></tr>
    </table>
  </div>

  <div class="card">
    <div class="card-head"><div class="card-icon icon-purple">🔍</div><div class="card-title">Bug Cause</div></div>
    <table>
      <tr><th>Type</th><th>Count</th></tr>
      ${Object.entries(d.bugCauseCount).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
      <tr class="total-row"><td>Total</td><td>${Object.values(d.bugCauseCount).reduce((a, b) => a + b, 0)}</td></tr>
    </table>
  </div>

  <div class="card">
    <div class="card-head"><div class="card-icon icon-blue">🧪</div><div class="card-title">Testing Activity</div></div>
    <table>
      <tr><th>Type</th><th>Count</th></tr>
      ${Object.entries(d.testingActivityCount).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
      <tr class="total-row"><td>Total</td><td>${Object.values(d.testingActivityCount).reduce((a, b) => a + b, 0)}</td></tr>
    </table>
  </div>

  <div class="card">
    <div class="card-head"><div class="card-icon icon-amber">🌐</div><div class="card-title">Environment Bug Found</div></div>
    <table>
      <tr><th>Combo</th><th>Count</th></tr>
      ${Object.entries(d.envCombinationCount).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
      <tr class="total-row"><td>Total</td><td>${Object.values(d.envCombinationCount).reduce((a, b) => a + b, 0)}</td></tr>
    </table>
  </div>

</div>

<div class="divider"><span></span><div class="line"></div></div>

<div class="grid-2">
  <div class="card">
    <div class="card-head">
      <div class="card-icon icon-green">🧩</div>
      <div class="card-title">Total Unique User Stories Linked with Bugs (${d.uniqueStories.size})</div>
    </div>
    <div>${allStoriesList}</div>
  </div>
  <div class="card">
    <div class="card-head">
      <div class="card-icon icon-indigo">🔄</div>
      <div class="card-title">Total Unique In Progress User Stories linked with Bugs (${d.uniqueInProgressStories.size})</div>
    </div>
    <div>${inProgressStoriesList}</div>
  </div>
</div>

<div class="divider"><span>Bug Summary</span><div class="line"></div></div>

<div class="card" style="margin-bottom: 28px;">
  <div class="summary">${summaryText}</div>
</div>

<div class="divider"><span>Critical &amp; High Bugs</span><div class="line"></div></div>

<div class="grid-2">
  <div class="card">
    <div class="card-head"><div class="card-icon icon-rose">🔥</div><div class="card-title">Critical Bugs (${d.criticalBugs.length})</div></div>
    <div>${d.criticalBugs.map(x => `• ${x.summary}`).join("<br>") || "None"}</div>
  </div>
  <div class="card">
    <div class="card-head"><div class="card-icon icon-orange">🔺</div><div class="card-title">High Bugs (${d.highBugs.length})</div></div>
    <div>${d.highBugs.map(x => `• ${x.summary}`).join("<br>") || "None"}</div>
  </div>
</div>

<div class="divider"><span>Medium &amp; Low Bugs</span><div class="line"></div></div>

<div class="grid-2">
  <div class="card">
    <div class="card-head"><div class="card-icon icon-yellow">⚠️</div><div class="card-title">Medium Bugs (${d.mediumBugs.length})</div></div>
    <div>${d.mediumBugs.map(x => `• ${x.summary}`).join("<br>") || "None"}</div>
  </div>
  <div class="card">
    <div class="card-head"><div class="card-icon icon-gray">🔹</div><div class="card-title">Low Bugs (${d.lowBugs.length})</div></div>
    <div>${d.lowBugs.map(x => `• ${x.summary}`).join("<br>") || "None"}</div>
  </div>
</div>
`;
}

// =======================
// PROCESS ALL PROJECTS
// =======================
const projectKeys = Object.keys(projectMap);

projectKeys.forEach(key => {
    projectMap[key]._d = processProject(projectMap[key].issues);
});

//<span class="tab-badge">${_d.validBugs}V&nbsp;/&nbsp;${_d.invalidBugs}I</span>
const tabButtons = projectKeys.map((key, i) => {
    const { name, _d } = projectMap[key];
    return `<button class="tab-btn${i === 0 ? ' active' : ''}" onclick="switchTab('${key}')" id="btn-${key}">
  ${name}
  
</button>`;
}).join("\n");

const tabPanels = projectKeys.map((key, i) => {
    const { name, _d } = projectMap[key];
    return `<div class="tab-panel${i === 0 ? ' active' : ''}" id="panel-${key}">
  ${buildDashboard(name, _d)}
</div>`;
}).join("\n");

// =======================
// RENDER
// =======================
pm.visualizer.set(`
<!DOCTYPE html><html><head>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f0fdf4;
  --surface: #ffffff;
  --surface2: #f7fffe;
  --border: rgba(16,130,90,0.12);
  --border2: rgba(13, 14, 13, 0.22);
  --text: #052e16;
  --muted: #4a7c6a;
  --accent: #0f766e;
  --green: #15803d;
  --red: #dc2626;
  --yellow: #ca8a04;
  --orange: #ea580c;
  --purple: #7c3aed;
}

body {
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--text);
  padding: 0;
}

/* ── TAB BAR ── */
.tab-bar{
  display:flex;flex-wrap:wrap;gap:4px;
  padding:14px 24px 0;
  background:#fff;
  border-bottom:2px solid var(--border2);
  position:sticky;top:0;z-index:100;
  box-shadow:0 2px 12px rgba(16,130,90,0.08);
}

.tab-btn{
  display:inline-flex;align-items:center;gap:8px;
  padding:9px 16px;
  border:1px solid var(--border2);border-bottom:none;
  border-radius:10px 10px 0 0;
  background:var(--bg);color:var(--muted);
  font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;
  cursor:pointer;
  transition:background 0.18s,color 0.18s;
  position:relative;bottom:-2px;
}
.tab-btn:hover{background:#e6faf4;color:var(--accent)}
.tab-btn.active{
  background:#fff;color:var(--accent);
  border-color:var(--border2);border-bottom-color:#fff;
  box-shadow:0 -3px 0 var(--accent) inset;
}

.tab-badge{
  font-family:'DM Mono',monospace;font-size:11px;font-weight:500;
  background:rgba(15,118,110,0.10);border:1px solid rgba(15,118,110,0.20);
  border-radius:20px;padding:2px 8px;color:var(--accent);
}
.tab-btn.active .tab-badge{background:rgba(15,118,110,0.18)}

/* ── PANELS ── */
.tab-panel{display:none;padding:28px}
.tab-panel.active{display:block}

/* ── HEADER ── */
.header { margin-bottom: 28px; }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  background: rgba(15,118,110,0.10);
  border: 1px solid rgba(15,118,110,0.28);
  border-radius: 6px;
  padding: 4px 12px;
  margin-bottom: 10px;
}

.badge::before {
  content: '';
  display: block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  line-height: 1.2;
  margin-bottom: 4px;
}

.meta {
  font-size: 14px;
  color: var(--muted);
  font-family: 'DM Mono', monospace;
}

.kpi-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
  margin: 22px 0;
}

.kpi {
  background: var(--surface);
  border-radius: 16px;
  border: 1px solid var(--border2);
  padding: 22px 24px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(16,130,90,0.08);
}

.kpi::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  border-radius: 16px 16px 0 0;
}

.kpi.valid::before      { background: linear-gradient(90deg, #15803d, #4ade80); }
.kpi.invalid::before    { background: linear-gradient(90deg, #dc2626, #fb7185); }
.kpi.unparented::before { background: linear-gradient(90deg, #ca8a04, #fde68a); }

.kpi-num {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1;
  margin-bottom: 6px;
}

.kpi.valid .kpi-num      { color: var(--green); }
.kpi.invalid .kpi-num    { color: var(--red); }
.kpi.unparented .kpi-num { color: var(--yellow); }

.kpi-label {
  font-size: 16px;
  color: var(--muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.kpi-sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
  font-style: italic;
}

/* ── NOTES BLOCK (Low / Medium optional lines) ── */
.notes-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(15,118,110,0.04);
  border-left: 3px solid rgba(15,118,110,0.30);
  border-radius: 0 8px 8px 0;
  padding: 10px 14px;
  margin: 8px 0 16px 0;
}

.note-header {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-top: 8px;
}

.note-header:first-child { margin-top: 0; }

.note-line {
  display: block;
  font-size: 13px;
  color: var(--muted);
  padding-left: 12px;
}

/* ── VALID / INVALID inline colors in summary ── */
.valid-count   { color: var(--green); }
.invalid-count { color: var(--red); }

.grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}

.card {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: 16px;
  padding: 18px 20px;
  box-shadow: 0 1px 6px rgba(16,130,90,0.07);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.card:hover {
  border-color: var(--border2);
  box-shadow: 0 6px 24px rgba(15,118,110,0.12);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.icon-teal   { background: rgba(15,118,110,0.12); }
.icon-purple { background: rgba(124,58,237,0.12); }
.icon-blue   { background: rgba(37,99,235,0.12); }
.icon-amber  { background: rgba(202,138,4,0.12); }
.icon-rose   { background: rgba(220,38,38,0.10); }
.icon-indigo { background: rgba(79,70,229,0.12); }
.icon-green  { background: rgba(21,128,61,0.12); }
.icon-orange { background: rgba(234,88,12,0.12); }
.icon-yellow { background: rgba(202,138,4,0.14); }
.icon-gray   { background: rgba(100,116,139,0.12); }

.card-icon {
  width: 32px; height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 16px;
  flex-shrink: 0;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}

table { width: 100%; border-collapse: collapse; }

th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--border2);
  text-align: left;
}

tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: rgba(15,118,110,0.04); }

td {
  padding: 10px 0;
  font-size: 14px;
  color: var(--text);
}

td:last-child {
  text-align: left;
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.total-row td {
  font-weight: 700;
  color: var(--text);
  border-top: 1px solid var(--border2) !important;
  padding-top: 12px;
  background: rgba(15,118,110,0.05);
}

.total-row td:last-child { color: var(--accent); }

.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 28px 0 16px;
}

.divider span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  white-space: nowrap;
}

.line {
  flex: 1;
  height: 1px;
  background: var(--border2);
}

.summary {
  font-size: 15px;
  color: #334155;
  line-height: 1.8;
}

.summary strong {
  color: var(--text);
  font-weight: 600;
}

.card > div:not(.card-head) {
  font-size: 14px;
  color: #475569;
  line-height: 1.75;
}
</style>
</head>
<body>

<div class="tab-bar">
${tabButtons}
</div>

${tabPanels}

<script>
function switchTab(key) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + key).classList.add('active');
  document.getElementById('btn-' + key).classList.add('active');
}
</script>
</body></html>
`);
