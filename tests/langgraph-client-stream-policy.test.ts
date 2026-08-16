import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@langchain/langgraph-sdk";

import { configureLangGraphClientStreamPolicy } from "../src/lib/langgraph-client";

type RunsClient = Client["runs"];

function makeClient(apiUrl: string) {
  return new Client({ apiUrl });
}

test("disables idle reconnect for local run streams while preserving stream results", async () => {
  const client = makeClient("http://localhost:8123");
  const originalPayload = {
    input: { prompt: "hello" },
    streamMode: "messages" as const,
  };
  const result = { id: "stream-result" };
  let received: unknown[] | undefined;

  client.runs.stream = ((...args: unknown[]) => {
    received = args;
    return result;
  }) as unknown as RunsClient["stream"];

  configureLangGraphClientStreamPolicy(client, "http://localhost:8123");

  const actual = client.runs.stream("thread-1", "assistant-1", originalPayload);

  assert.equal(actual, result);
  assert.deepEqual(received, [
    "thread-1",
    "assistant-1",
    { ...originalPayload, streamIdleReconnect: 0 },
  ]);
  assert.deepEqual(originalPayload, {
    input: { prompt: "hello" },
    streamMode: "messages",
  });
});

test("disables idle reconnect for local joined streams and preserves options", async () => {
  const client = makeClient("http://127.0.0.1:8123");
  const originalOptions = {
    lastEventId: "event-1",
    streamMode: ["updates" as const],
  };
  const result = { id: "joined-stream-result" };
  let received: unknown[] | undefined;

  client.runs.joinStream = ((...args: unknown[]) => {
    received = args;
    return result;
  }) as unknown as RunsClient["joinStream"];

  configureLangGraphClientStreamPolicy(client, "http://127.0.0.1:8123");

  const actual = client.runs.joinStream("thread-1", "run-1", originalOptions);

  assert.equal(actual, result);
  assert.deepEqual(received, [
    "thread-1",
    "run-1",
    { ...originalOptions, streamIdleReconnect: 0 },
  ]);
  assert.deepEqual(originalOptions, {
    lastEventId: "event-1",
    streamMode: ["updates"],
  });
});

test("wraps a local AbortSignal join option with idle reconnect policy", () => {
  const client = makeClient("http://localhost:8123");
  const signal = new AbortController().signal;
  let receivedOptions: unknown;

  client.runs.joinStream = ((
    _threadId: unknown,
    _runId: unknown,
    options: unknown
  ) => {
    receivedOptions = options;
    return "joined";
  }) as unknown as RunsClient["joinStream"];

  configureLangGraphClientStreamPolicy(client, "http://localhost:8123");

  assert.equal(client.runs.joinStream("thread-1", "run-1", signal), "joined");
  assert.deepEqual(receivedOptions, {
    signal,
    streamIdleReconnect: 0,
  });
});

test("leaves remote clients and payload references untouched", () => {
  const client = makeClient("https://localhost.example.com");
  const payload = { input: { prompt: "hello" } };
  const options = { lastEventId: "event-1" };
  let streamArgs: unknown[] | undefined;
  let joinArgs: unknown[] | undefined;

  client.runs.stream = ((...args: unknown[]) => {
    streamArgs = args;
    return "stream";
  }) as unknown as RunsClient["stream"];
  client.runs.joinStream = ((...args: unknown[]) => {
    joinArgs = args;
    return "join";
  }) as unknown as RunsClient["joinStream"];
  const stream = client.runs.stream;
  const joinStream = client.runs.joinStream;

  configureLangGraphClientStreamPolicy(client, "https://localhost.example.com");

  assert.equal(
    client.runs.stream("thread-1", "assistant-1", payload),
    "stream"
  );
  assert.equal(client.runs.joinStream("thread-1", "run-1", options), "join");
  assert.equal(streamArgs?.[2], payload);
  assert.equal(joinArgs?.[2], options);
  assert.equal(stream, client.runs.stream);
  assert.equal(joinStream, client.runs.joinStream);
});

test("parses IPv6 localhost and fails safe for invalid or relative URLs", () => {
  for (const deploymentUrl of [
    "http://[::1]:8123",
    "",
    "/relative/path",
    "not a URL",
  ]) {
    const client = makeClient("https://remote.example.com");
    const stream = client.runs.stream;
    const joinStream = client.runs.joinStream;

    assert.doesNotThrow(() =>
      configureLangGraphClientStreamPolicy(client, deploymentUrl)
    );

    if (deploymentUrl === "http://[::1]:8123") {
      assert.notEqual(client.runs.stream, stream);
      assert.notEqual(client.runs.joinStream, joinStream);
    } else {
      assert.equal(client.runs.stream, stream);
      assert.equal(client.runs.joinStream, joinStream);
    }
  }
});

test("does not wrap a client more than once", () => {
  const client = makeClient("http://localhost:8123");
  let calls = 0;
  client.runs.stream = ((...args: unknown[]) => {
    calls += 1;
    return args[2];
  }) as unknown as RunsClient["stream"];

  configureLangGraphClientStreamPolicy(client, "http://localhost:8123");
  const wrappedStream = client.runs.stream;
  configureLangGraphClientStreamPolicy(client, "http://localhost:8123");

  assert.equal(client.runs.stream, wrappedStream);
  assert.deepEqual(client.runs.stream("thread-1", "assistant-1"), {
    streamIdleReconnect: 0,
  });
  assert.equal(calls, 1);
});
