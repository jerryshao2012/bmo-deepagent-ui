import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example.com/login",
});

for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (
    ["window", "document", "navigator", "localStorage"].includes(key) ||
    key in globalThis
  ) {
    continue;
  }

  Object.defineProperty(
    globalThis,
    key,
    Object.getOwnPropertyDescriptor(dom.window, key)!
  );
}

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  localStorage: { configurable: true, value: dom.window.localStorage },
  Event: { configurable: true, value: dom.window.Event },
  CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  IS_REACT_ACT_ENVIRONMENT: {
    configurable: true,
    value: true,
    writable: true,
  },
});
