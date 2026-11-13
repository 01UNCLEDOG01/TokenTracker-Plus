const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// The usage-limits aggregation feeds a positional array destructure from one
// giant Promise.all: the Nth fetch argument lands in the Nth destructured
// name, so a reordered insertion silently swaps two providers' data (that bug
// shipped once: mistral/openaiCredits were inserted before opendesign while
// the destructure had them after). These fetchers take the same arguments and
// return the same shape, so nothing downstream would crash — the cards would
// just show the wrong vendor's numbers. Lock the alignment structurally.
test("usage-limits Promise.all argument order matches the positional destructure", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "usage-limits.js"),
    "utf8",
  );

  const destructureMatch = source.match(
    /const \[claudeResult, codexResult, cursor([^\]]+)\] = await Promise\.all\(\[([\s\S]*?)\n  \]\);/,
  );
  assert.ok(destructureMatch, "the aggregation destructure was found");

  const names = ["claudeResult", "codexResult", "cursor"]
    .concat(
      destructureMatch[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    );
  const body = destructureMatch[2];

  const fetchIds = [...body.matchAll(/hiddenSet\.has\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.ok(fetchIds.length >= names.length - 2,
    "every Promise.all entry is a hiddenSet fetch (comments excluded)");

  // The hidden provider sentinel and trailing non-fetch entries would break a
  // strict 1:1 walk, so align from the tail: the last four fetch ids must be
  // exactly the last four destructured names, in order. This is where the
  // real bug lived (vyceai, opendesign, mistral, openaiCredits).
  const fetchTail = fetchIds.slice(-4);
  const nameTail = names.slice(-4);
  assert.deepEqual(
    fetchTail,
    nameTail,
    `tail order drift: fetch args [${fetchTail.join(", ")}] vs destructure [${nameTail.join(", ")}]`,
  );

  // The tail-4 alignment above is the load-bearing lock (it is where the
  // real bug lived). Additionally pin the providers this guard was written
  // for explicitly, so a future reorder of any of them fails with a clear
  // name regardless of where they sit in the tail.
  for (const name of ["vyceai", "opendesign", "mistral", "openaiCredits", "minimaxCode", "hark"]) {
    assert.ok(fetchIds.includes(name), `fetch list must contain '${name}'`);
    assert.ok(names.includes(name), `destructure must contain '${name}'`);
    assert.equal(fetchIds.indexOf(name), fetchIds.lastIndexOf(name), `'${name}' appears exactly once in the fetch list`);
  }
});
