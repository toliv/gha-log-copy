const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function setup(fetchImplementation) {
  const timers = new Map();
  let timerId = 0;
  const writes = [];
  const requests = [];
  const context = vm.createContext({
    URL,
    AbortController,
    console: { error() {}, warn() {} },
    window: {
      location: { origin: "https://github.com", pathname: "/owner/repo/actions/runs/1/job/2" },
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); }
    },
    document: { documentElement: {}, addEventListener() {} },
    MutationObserver: class { observe() {} },
    navigator: { clipboard: { async writeText(text) { writes.push(text); } } },
    async fetch(url, options) {
      requests.push({ url, options });
      return fetchImplementation(url, options);
    },
    DOMParser: class {
      parseFromString() { throw new Error("Plain text must not pass through an HTML parser"); }
    }
  });
  vm.runInContext(source, context);
  // Expansion is independent of log retrieval. Simulate an already loaded step.
  vm.runInContext("ensureStepExpanded = async () => {};", context);
  return { context, timers, writes, requests };
}

function response(body, contentType = "text/plain; charset=utf-8", status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "https://github.com/owner/repo/checks/logs/1",
    headers: { get: () => contentType },
    async text() { return body; }
  };
}

function step(logUrl = "/owner/repo/commit/abc/checks/2/logs/3") {
  return {
    getAttribute() { return logUrl; },
    querySelector() { throw new Error("Must not read the virtualized DOM as a fallback"); }
  };
}

async function click(context, selectedStep = step()) {
  const button = {
    dataset: {},
    disabled: false,
    closest: () => selectedStep,
    setAttribute(name, value) { this[name] = value; }
  };
  await context.handleCopyButtonClick({
    currentTarget: button,
    preventDefault() {},
    stopPropagation() {}
  });
  return button;
}

test("copies all 100,000 plain-text lines including angle brackets and the final line", async () => {
  const text = Array.from({ length: 100000 }, (_, i) => `  line ${i + 1}: expected < actual & <tag>`).join("\n");
  const { context, writes, requests } = setup(async () => response(text));
  const button = await click(context);
  assert.deepEqual(writes, [text]);
  assert.equal(writes[0].split("\n").length, 100000);
  assert.equal(button.dataset.state, "success");
  assert.equal(requests.length, 1);
});

test("error mode copies only annotated and error-level lines", () => {
  const { context } = setup(async () => response("unused"));
  assert.equal(
    context.filterErrorLines("start\n##[error] failed to compile\ninfo\nERROR: bad input\nfinish"),
    "##[error] failed to compile\nERROR: bad input"
  );
});

for (const [name, fetchImplementation] of [
  ["network failure", async () => { throw new Error("offline"); }],
  ["HTTP failure", async () => response("Not Found", "text/plain", 404)],
  ["partial HTTP response", async () => response("only 117 lines", "text/plain", 206)],
  ["unknown JSON format", async () => response('{"error":"not a log"}', "application/json")],
  ["missing content type", async () => response("not a verified log", null)],
  ["empty log", async () => response("")]
]) {
  test(`${name} leaves the clipboard unchanged instead of copying visible DOM lines`, async () => {
    const { context, writes } = setup(fetchImplementation);
    const button = await click(context);
    assert.deepEqual(writes, []);
    assert.equal(button.dataset.state, "error");
    assert.equal(button.disabled, false);
    assert.match(button.title, /Clipboard unchanged/);
  });
}

test("rejects an external log URL before fetching", async () => {
  const { context, requests } = setup(async () => response("external"));
  await assert.rejects(context.getStepLogText(step("https://example.com/log")), /outside GitHub/);
  assert.equal(requests.length, 0);
});

test("uses same-origin credentials and follows GitHub redirects", async () => {
  const { context, requests } = setup(async () => response("log"));
  await context.getStepLogText(step());
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.redirect, "follow");
});

test("accepts GitHub Actions storage redirect hosts", async () => {
  const { context } = setup(async () => ({
    ...response("log"),
    url: "https://pipelines.actions.githubusercontent.com/serviceHosts/example/log"
  }));
  assert.equal(await context.getStepLogText(step()), "log");
});

test("rejects an unrelated redirected host", async () => {
  const { context } = setup(async () => ({
    ...response("log"),
    url: "https://evil.example/log"
  }));
  await assert.rejects(context.getStepLogText(step()), /unexpected host/);
});

test("timeouts abort the request and allow a retry without writing a partial log", async () => {
  const { context, timers, writes } = setup((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  const pendingClick = click(context);
  await Promise.resolve();
  // The initial scan timer is first; the fetch timeout is the latest timer.
  [...timers.values()].at(-1)();
  const button = await pendingClick;
  assert.equal(button.dataset.state, "error");
  assert.equal(button.disabled, false);
  assert.deepEqual(writes, []);
});

test("a previous success timer cannot reset the button while a retry is fetching", async () => {
  let completeFetch;
  const { context, timers } = setup(async () => {
    if (!completeFetch) return response("log");
    return new Promise(resolve => { completeFetch = () => resolve(response("log again")); });
  });
  const button = await click(context);
  const oldTimer = [...timers.keys()].at(-1);
  completeFetch = true;
  const retry = context.handleCopyButtonClick({ currentTarget: button, preventDefault() {}, stopPropagation() {} });
  await Promise.resolve();
  assert.equal(timers.has(oldTimer), false);
  assert.equal(button.disabled, true);
  completeFetch();
  await retry;
  assert.equal(button.dataset.state, "success");
});
