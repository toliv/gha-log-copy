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

async function click(context, mode = "all") {
  const button = {
    dataset: { ghaCopyButton: mode },
    disabled: false,
    closest: () => step(),
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

const TIMESTAMP = "2026-01-02T03:04:05.1234567Z ";

test("error mode recognizes failures from many tools", () => {
  const { context } = setup(async () => response("unused"));
  const errors = [
    "##[error]Process completed with exit code 1.",
    "::error file=example.txt,line=5::Invalid input",
    "ERROR: bad input",
    "\u001b[31m[CRITICAL]\u001b[0m could not continue",
    "2026-01-02 03:04:05,123 42 ␛[31mERROR␛[0m worker: invalid input",
    "example.txt:5:3: error: invalid value",
    "src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    "  1:7  error  'x' is assigned a value but never used  no-unused-vars",
    "make: *** [Makefile:3: all] Error 1",
    "npm ERR! code ELIFECYCLE",
    "--- FAIL: TestParse (0.00s)",
    "panic: runtime error: index out of range [3] with length 3",
    "thread 'main' panicked at src/main.rs:4:5:",
    "FAILED tests/test_a.py::test_x - AssertionError: assert 1 == 2",
    "Traceback (most recent call last):",
    "TypeError [ERR_INVALID_ARG_TYPE]: invalid input",
    'Exception in thread "main" java.lang.IllegalStateException: failed',
    "Tests: 1 failed, 0 errors"
  ];
  const noise = [
    "start",
    "INFO: checking error handling",
    "2026-01-02 03:04:05,123 42 WARNING worker: expected exception",
    "[debug] retrying after error",
    "##[group]Run pytest --fail-fast",
    "##[warning]Node 16 is deprecated; errors may occur",
    "Found 0 errors",
    "Done, no failures",
    "user terror level: none" // documents the accepted false-positive direction
  ];
  // Lines that carry their own logger timestamp are used as-is.
  const stamp = line => line.startsWith("2026-") ? line : TIMESTAMP + line;
  for (const line of errors) {
    assert.equal(context.isErrorLine(stamp(line)), true, line);
  }
  for (const line of noise.slice(0, -1)) {
    assert.equal(context.isErrorLine(stamp(line)), false, line);
  }
  assert.equal(context.isErrorLine(noise.at(-1)), true);
});

test("error mode keeps context around matches, separates blocks and appends the step tail", () => {
  const { context } = setup(async () => response("unused"));
  const lines = Array.from({ length: 60 }, (_, index) => `line ${index}`);
  lines[10] = "ERROR: first";
  lines[30] = "ERROR: second";
  const expected = [
    ...lines.slice(8, 14),
    "...",
    ...lines.slice(28, 34),
    "...",
    ...lines.slice(40)
  ];
  assert.equal(context.filterErrorLines(lines.join("\n")), expected.join("\n"));
});

test("error mode follows indented stack frames past the context window", () => {
  const { context } = setup(async () => response("unused"));
  const frames = Array.from({ length: 30 }, (_, index) => `  File "example.py", line ${index}, in f${index}`);
  const traceback = ["Traceback (most recent call last):", ...frames, "ValueError: bad input"];
  const goPanic = [
    "panic: runtime error: index out of range",
    "",
    "goroutine 1 [running]:",
    "main.main()",
    "\t/app/main.go:8 +0x1d"
  ];
  const filler = Array.from({ length: 10 }, (_, index) => `filler ${index}`);
  const tail = Array.from({ length: 20 }, (_, index) => `tail ${index}`);
  const log = [...filler, ...traceback, ...filler, ...goPanic, ...filler, ...tail];
  const expected = [
    ...filler.slice(-2), ...traceback, ...filler.slice(0, 3),
    "...",
    ...filler.slice(-2), ...goPanic,
    "...",
    ...tail
  ];
  assert.equal(
    context.filterErrorLines(log.map(line => TIMESTAMP + line).join("\n")),
    expected.map(line => line === "..." ? line : TIMESTAMP + line).join("\n")
  );
});

test("error mode treats untimestamped lines as the body of the preceding logger record", () => {
  const { context } = setup(async () => response("unused"));
  const record = (level, text) => `2026-01-02 03:04:05,123 42 ␛[1;32m${level}␛[0m app: ${text}`;
  const traceback = [
    "Traceback (most recent call last):",
    '  File "example.py", line 5, in run',
    "    raise ValueError()",
    "ValueError: bad input"
  ];
  const filler = Array.from({ length: 5 }, (_, index) => record("INFO", `filler ${index}`));
  const log = [
    record("INFO", "Starting test_rejects_error_input"),
    record("INFO", "expected failure path"),
    ...traceback,
    ...filler,
    record("ERROR", "FAIL: test_real_failure"),
    ...traceback,
    ...filler,
    ...Array.from({ length: 20 }, (_, index) => record("INFO", `tail ${index}`))
  ].map(line => TIMESTAMP + line);
  // ERROR record at 11 with 2 lines before; its final "ValueError" line (15) adds 3 after.
  const expected = [...log.slice(9, 19), "...", ...log.slice(-20)];
  assert.equal(context.filterErrorLines(log.join("\n")), expected.join("\n"));
});

test("error mode copies the filtered log through the button", async () => {
  const log = ["start", "ERROR: bad input", "finish"].map(line => TIMESTAMP + line).join("\n");
  const { context, writes } = setup(async () => response(log));
  const button = await click(context, "errors");
  assert.deepEqual(writes, [log]);
  assert.equal(button.dataset.state, "success");
});

test("error mode leaves the clipboard unchanged when there are no errors", async () => {
  const { context, writes } = setup(async () => response(
    "INFO: expected exception\nall good\nFound 0 errors"
  ));
  const button = await click(context, "errors");
  assert.deepEqual(writes, []);
  assert.equal(button.dataset.state, "error");
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
