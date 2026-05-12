#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/analyze-har.mjs <path-to-har> [--out <path-to-output>]");
  process.exit(1);
}

const harPath = path.resolve(args[0]);
const outIndex = args.indexOf("--out");
const outPath = outIndex !== -1 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : null;

if (!fs.existsSync(harPath)) {
  console.error(`HAR file not found: ${harPath}`);
  process.exit(1);
}

function safeParseHar(fileText) {
  try {
    return JSON.parse(fileText);
  } catch (error) {
    console.error("Failed to parse HAR as JSON.");
    console.error(String(error));
    process.exit(1);
  }
}

function parseSseEvents(content) {
  const lines = content.split(/\r?\n/);
  const events = [];
  let currentEvent = null;
  let currentData = [];
  let currentId = null;

  const flush = () => {
    if (!currentEvent && currentData.length === 0) {
      return;
    }
    events.push({
      event: currentEvent || "message",
      id: currentId,
      dataRaw: currentData.join("\n"),
    });
    currentEvent = null;
    currentData = [];
    currentId = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }

    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("id:")) {
      currentId = line.slice("id:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      currentData.push(line.slice("data:".length).trim());
      continue;
    }
  }

  flush();
  return events;
}

function safeJson(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function collectToolCallsFromMessage(message) {
  if (!message || typeof message !== "object") {
    return [];
  }

  const messageObj = message;
  if (Array.isArray(messageObj.tool_calls)) {
    return messageObj.tool_calls;
  }

  if (
    messageObj.additional_kwargs &&
    typeof messageObj.additional_kwargs === "object" &&
    Array.isArray(messageObj.additional_kwargs.tool_calls)
  ) {
    return messageObj.additional_kwargs.tool_calls;
  }

  return [];
}

function hasSubagentMarker(toolCall) {
  if (!toolCall || typeof toolCall !== "object") {
    return false;
  }

  const argsObj = toolCall.args && typeof toolCall.args === "object" ? toolCall.args : {};
  return typeof argsObj.subagent_type === "string" && argsObj.subagent_type.length > 0;
}

const fileText = fs.readFileSync(harPath, { encoding: "utf8" });
const har = safeParseHar(fileText);
const entries = har?.log?.entries;

if (!Array.isArray(entries)) {
  console.error("No log.entries found in HAR.");
  process.exit(1);
}

const streamEntries = entries.filter((entry) => {
  const url = entry?.request?.url;
  return typeof url === "string" && url.includes("/runs/stream");
});

if (streamEntries.length === 0) {
  console.log("No /runs/stream entries found in HAR.");
  process.exit(0);
}

let selectedEntry = streamEntries[0];
for (const entry of streamEntries) {
  const currentLen = entry?.response?.content?.text?.length || 0;
  const selectedLen = selectedEntry?.response?.content?.text?.length || 0;
  if (currentLen > selectedLen) {
    selectedEntry = entry;
  }
}

const responseContent = selectedEntry?.response?.content?.text || "";
const responseMime = selectedEntry?.response?.content?.mimeType || "";
const streamUrl = selectedEntry?.request?.url || "";

console.log(`HAR: ${harPath}`);
console.log(`Stream URL: ${streamUrl}`);
console.log(`Response mimeType: ${responseMime}`);
console.log(`Response size: ${responseContent.length} chars`);

if (!responseContent) {
  console.log("Stream response content is empty in HAR.");
  process.exit(0);
}

const events = parseSseEvents(responseContent);
console.log(`Parsed SSE events: ${events.length}`);

const eventCounts = new Map();
for (const evt of events) {
  eventCounts.set(evt.event, (eventCounts.get(evt.event) || 0) + 1);
}

console.log("Event counts:");
for (const [eventName, count] of eventCounts.entries()) {
  console.log(`  ${eventName}: ${count}`);
}

const summary = {
  hasTaskToolCall: false,
  hasSubagentType: false,
  hasAnyToolCalls: false,
  hasToolCallId: false,
  subagentTypes: new Set(),
  firstTaskToolCall: null,
  firstSubagentToolCall: null,
};

for (const evt of events) {
  const parsedData = safeJson(evt.dataRaw);
  if (!parsedData) {
    continue;
  }

  let candidateMessages = [];
  if (evt.event === "values" && parsedData && typeof parsedData === "object") {
    candidateMessages = Array.isArray(parsedData.messages) ? parsedData.messages : [];
  } else if (evt.event === "messages") {
    candidateMessages = Array.isArray(parsedData) ? parsedData : [];
  }

  for (const message of candidateMessages) {
    const toolCalls = collectToolCallsFromMessage(message);
    if (toolCalls.length === 0) {
      continue;
    }

    summary.hasAnyToolCalls = true;

    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== "object") {
        continue;
      }

      if (typeof toolCall.id === "string" && toolCall.id.length > 0) {
        summary.hasToolCallId = true;
      }

      const name = typeof toolCall.name === "string" ? toolCall.name : "";
      if (name === "task") {
        summary.hasTaskToolCall = true;
        if (!summary.firstTaskToolCall) {
          summary.firstTaskToolCall = toolCall;
        }
      }

      if (hasSubagentMarker(toolCall)) {
        summary.hasSubagentType = true;
        const subagentType = toolCall.args.subagent_type;
        summary.subagentTypes.add(subagentType);
        if (!summary.firstSubagentToolCall) {
          summary.firstSubagentToolCall = toolCall;
        }
      }
    }
  }
}

console.log("\nSubagent/Tool findings:");
console.log(`  hasAnyToolCalls: ${summary.hasAnyToolCalls}`);
console.log(`  hasTaskToolCall: ${summary.hasTaskToolCall}`);
console.log(`  hasSubagentType: ${summary.hasSubagentType}`);
console.log(`  hasToolCallId: ${summary.hasToolCallId}`);
console.log(
  `  subagentTypes: ${summary.subagentTypes.size > 0 ? Array.from(summary.subagentTypes).join(", ") : "(none)"}`
);

if (summary.firstTaskToolCall) {
  console.log("\nFirst task tool call sample:");
  console.log(JSON.stringify(summary.firstTaskToolCall, null, 2));
}

if (summary.firstSubagentToolCall) {
  console.log("\nFirst subagent-marked tool call sample:");
  console.log(JSON.stringify(summary.firstSubagentToolCall, null, 2));
}

if (outPath) {
  const report = {
    harPath,
    streamUrl,
    responseMime,
    responseSize: responseContent.length,
    eventCounts: Object.fromEntries(eventCounts.entries()),
    findings: {
      hasAnyToolCalls: summary.hasAnyToolCalls,
      hasTaskToolCall: summary.hasTaskToolCall,
      hasSubagentType: summary.hasSubagentType,
      hasToolCallId: summary.hasToolCallId,
      subagentTypes: Array.from(summary.subagentTypes),
      firstTaskToolCall: summary.firstTaskToolCall,
      firstSubagentToolCall: summary.firstSubagentToolCall,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), { encoding: "utf8" });
  console.log(`\nWrote analysis report: ${outPath}`);
}
