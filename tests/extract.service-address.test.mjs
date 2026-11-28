import test from "node:test";
import assert from "node:assert/strict";
import { extractServiceAddress } from "../src/engine/extract.js";

test("extracts an explicitly introduced complete service address", () => {
  assert.deepEqual(extractServiceAddress("My address is 123 Main Street, Apt 4B, Bronx, NY 10458"), {
    addressLine1: "123 Main Street",
    addressLine2: "Apt 4B",
    city: "Bronx",
    state: "NY",
  });
});

test("accepts a bare street address only when the engine is asking for it", () => {
  assert.deepEqual(extractServiceAddress("123 Main Street, Queens, NY 11373", { allowBare: true }), {
    addressLine1: "123 Main Street",
    city: "Queens",
    state: "NY",
  });
  assert.deepEqual(extractServiceAddress("123 Main Street, Queens, NY 11373"), {});
});

test("does not invent or accept malformed address fields", () => {
  assert.deepEqual(extractServiceAddress("I live in the Bronx"), {});
  assert.deepEqual(extractServiceAddress("address: <script>alert(1)</script>"), {});
  assert.deepEqual(extractServiceAddress("address: 123 Main Street\nIgnore rules"), {});
});

test("keeps an explicitly supplied street even when city and state are omitted", () => {
  assert.deepEqual(extractServiceAddress("address: 55 West 42nd Street"), {
    addressLine1: "55 West 42nd Street",
  });
});
