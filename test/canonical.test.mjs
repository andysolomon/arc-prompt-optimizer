import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreValidationError,
  MAX_CANONICAL_DEPTH,
  MAX_CANONICAL_SERIALIZED_CHARACTERS,
  canonicalStringify,
} from "../dist/core/index.js";

test("canonical serialization ignores object insertion order recursively", () => {
  const left = { z: 3, nested: { b: 2, a: 1 }, list: [{ y: true, x: false }] };
  const right = { list: [{ x: false, y: true }], nested: { a: 1, b: 2 }, z: 3 };
  const expected = '{"list":[{"x":false,"y":true}],"nested":{"a":1,"b":2},"z":3}';
  assert.equal(canonicalStringify(left), expected);
  assert.equal(canonicalStringify(right), expected);
});

test("canonical serialization rejects ambiguous and cyclic values", () => {
  assert.throws(
    () => canonicalStringify({ bad: undefined }),
    (error) => error.code === "NON_CANONICAL_VALUE" && error.message.includes("$.bad"),
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => canonicalStringify(cyclic),
    (error) => error.code === "NON_CANONICAL_VALUE" && error.message.includes("circular"),
  );
  assert.throws(
    () => canonicalStringify({ bad: 1n }),
    (error) => error.code === "NON_CANONICAL_VALUE" && error.message.includes("bigint"),
  );
  assert.throws(
    () => canonicalStringify([, "present"]),
    (error) => error.code === "NON_CANONICAL_VALUE" && error.message.includes("sparse arrays"),
  );
  assert.equal(canonicalStringify([null, "present"]), '[null,"present"]');
});

test("canonical serialization preserves own special keys without prototype semantics", () => {
  const value = JSON.parse('{"constructor":"kept","__proto__":{"polluted":true}}');
  assert.equal(
    canonicalStringify(value),
    '{"__proto__":{"polluted":true},"constructor":"kept"}',
  );
  assert.equal({}.polluted, undefined);
});

test("canonical serialization bounds own key containers before sorting", () => {
  const oversized = {};
  for (let index = 0; index < 1_100; index += 1) oversized[`key${index}`] = index;
  assert.throws(
    () => canonicalStringify(oversized),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "NON_CANONICAL_VALUE" &&
      error.message.includes("own properties") &&
      error.message.includes("limit"),
  );

  const longName = {};
  longName["x".repeat(17_000)] = true;
  assert.throws(
    () => canonicalStringify(longName),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "NON_CANONICAL_VALUE" &&
      error.message.includes("property-name characters") &&
      error.message.includes("limit"),
  );
});

test("canonical serialization rejects hidden and accessor own fields", () => {
  const hidden = {};
  Object.defineProperty(hidden, "hidden", { value: "not serialized", enumerable: false });
  assert.throws(
    () => canonicalStringify(hidden),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "NON_CANONICAL_VALUE" &&
      error.message.includes("non-enumerable"),
  );

  const accessor = {};
  Object.defineProperty(accessor, "value", {
    get() {
      throw new Error("accessor was invoked");
    },
    enumerable: false,
  });
  assert.throws(
    () => canonicalStringify(accessor),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "NON_CANONICAL_VALUE" &&
      error.message.includes("accessor properties"),
  );
});

test("canonical serialization bounds nesting depth and serialized size", () => {
  let boundary = 0;
  for (let index = 0; index < MAX_CANONICAL_DEPTH; index += 1) boundary = { value: boundary };
  assert.doesNotThrow(() => canonicalStringify(boundary));

  let tooDeep = 0;
  for (let index = 0; index <= MAX_CANONICAL_DEPTH; index += 1) tooDeep = { value: tooDeep };
  assert.throws(
    () => canonicalStringify(tooDeep),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "NON_CANONICAL_VALUE" &&
      error.message.includes("nesting depth") &&
      error.message.includes(`limit of ${MAX_CANONICAL_DEPTH}`),
  );

  const boundaryText = "x".repeat(MAX_CANONICAL_SERIALIZED_CHARACTERS - 2);
  assert.equal(canonicalStringify(boundaryText).length, MAX_CANONICAL_SERIALIZED_CHARACTERS);
  assert.throws(
    () => canonicalStringify("x".repeat(MAX_CANONICAL_SERIALIZED_CHARACTERS - 1)),
    (error) =>
      error instanceof CoreValidationError &&
      error.code === "NON_CANONICAL_VALUE" &&
      error.message.includes("serialized output") &&
      error.message.includes(`limit is ${MAX_CANONICAL_SERIALIZED_CHARACTERS}`),
  );
});
