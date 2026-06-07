// ─────────────────────────────────────────
// Bug Dashboard — Express Server
// Author: Akash Deep (ported to Node.js)
// ─────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────
// Jira API helper
// ─────────────────────────────────────────
const jiraClient = axios.create({
  baseURL: `${process.env.JIRA_BASE_URL}/rest/api/2`,
  auth: {
    username: process.env.JIRA_EMAIL,
    password: process.env.JIRA_API_TOKEN,
  },
  headers: { "Content-Type": "application/json" },
});

async function fetchFilter(filterId, fields, maxResults = 100) {
  const response = await jiraClient.post("/search", {
    jql: `filter = ${filterId}`,
    maxResults,
    fields,
  });
  return response.data;
}

// ─────────────────────────────────────────
// Data processing — Valid Bugs
// ─────────────────────────────────────────
function processValidBugs(data) {
  const projectName =
    data.issues?.[0]?.fields?.project?.name || "Unknown Project";

  let priorityCount = {};
  let bugCauseCount = {};
  let testingActivityCount = {};
  let envCombinationCount = {};
  let criticalBugs = [];
  let highBugs = [];
  let bugsWithStories = 0;
  let bugsWithInProgressStories = 0;
  let uniqueStories = new Set();
  let uniqueInProgressStories = new Set();
  let unlinkedBugs = 0;

  data.issues.forEach((issue) => {
    const fields = issue.fields || {};
    const priority = fields.priority?.name || "Unknown";
    const summary = fields.summary || "";

    priorityCount[priority] = (priorityCount[priority] || 0) + 1;
    if (priority.toLowerCase() === "critical") criticalBugs.push(summary);
    if (priority.toLowerCase() === "high") highBugs.push(summary);

    // Bug Cause
    const bugCauseArr = Array.isArray(fields.customfield_10166)
      ? fields.customfield_10166
      : fields.customfield_10166
      ? [fields.customfield_10166]
      : [];
    bugCauseArr.forEach((c) => {
      if (c?.value)
        bugCauseCount[c.value] = (bugCauseCount[c.value] || 0) + 1;
    });

    // Testing Activity
    const testingArr = Array.isArray(fields.customfield_10747)
      ? fields.customfield_10747
      : fields.customfield_10747
      ? [fields.customfield_10747]
      : [];
    testingArr.forEach((t) => {
      if (t?.value)
        testingActivityCount[t.value] =
          (testingActivityCount[t.value] || 0) + 1;
    });

    // Environment
    const envValues = (fields.customfield_10750 || [])
      .map((x) => x.value)
      .filter(Boolean);
    const comboKey = envValues.length
      ? [...new Set(envValues)].sort().join(" / ")
      : "None";
    envCombinationCount[comboKey] = (envCombinationCount[comboKey] || 0) + 1;

    // User Stories
    const links = fields.issuelinks || [];
    let bugHasStory = false;
    let bugHasInProgressStory = false;

    links.forEach((link) => {
      if (link.type?.inward !== "Testing discovered") return;
      const linked = link.outwardIssue || link.inwardIssue;
      if (!linked?.key) return;
      const issueType = linked.fields?.issuetype?.name || "";
      if (issueType !== "Story" && issueType !== "Task") return;

      bugHasStory = true;
      uniqueStories.add(linked.key);

      const status = linked.fields?.status?.name || "";
      const isInProgress = !["Done", "Closed", "Resolved"].includes(status);
      if (isInProgress) {
        bugHasInProgressStory = true;
        uniqueInProgressStories.add(linked.key);
      }
    });

    if (bugHasStory) bugsWithStories++;
    if (bugHasInProgressStory) bugsWithInProgressStories++;
    if (!bugHasStory) unlinkedBugs++;
  });

  return {
    projectName,
    validBugsTotal: data.total,
    priorityCount,
    bugCauseCount,
    testingActivityCount,
    envCombinationCount,
    criticalBugs,
    highBugs,
    bugsWithStories,
    bugsWithInProgressStories,
    uniqueStories: Array.from(uniqueStories),
    uniqueInProgressStories: Array.from(uniqueInProgressStories),
    unlinkedBugs,
  };
}

// ─────────────────────────────────────────
// Data processing — Invalid Bugs
// ─────────────────────────────────────────
function processInvalidBugs(data) {
  let invalidByResolution = {};
  data.issues.forEach((issue) => {
    const resolution = issue.fields?.resolution?.name || "Unresolved";
    invalidByResolution[resolution] =
      (invalidByResolution[resolution] || 0) + 1;
  });
  return {
    invalidBugsTotal: data.total,
    invalidByResolution,
  };
}

// ─────────────────────────────────────────
// API Route — fetch all dashboard data
// ─────────────────────────────────────────
app.get("/api/dashboard", async (req, res) => {
  try {
    const [validData, invalidData, storiesData] = await Promise.all([
      fetchFilter(process.env.VALID_BUGS_FILTER_ID, [
        "project", "issuelinks", "summary", "status", "resolution",
        "assignee", "priority", "customfield_10750",
        "customfield_10166", "customfield_10747",
      ]),
      fetchFilter(process.env.INVALID_BUGS_FILTER_ID, ["resolution", "project"]),
      fetchFilter(process.env.PASSED_STORIES_FILTER_ID, ["summary"], 1),
    ]);

    const validResult = processValidBugs(validData);
    const invalidResult = processInvalidBugs(invalidData);

    res.json({
      ...validResult,
      ...invalidResult,
      passedStoriesTotal: storiesData.total,
    });
  } catch (err) {
    console.error("❌ Jira API error:", err.message);
    res.status(500).json({
      error: err.message,
      hint: "Check your .env file — JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, and filter IDs.",
    });
  }
});

// ─────────────────────────────────────────
// Start server
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Bug Dashboard running at http://localhost:${PORT}\n`);
});
