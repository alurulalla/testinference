import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { patternOf, shapeOf } from "./template.js";

describe("recognising one screen seen many times", () => {
  it("takes the identifier out of an address", () => {
    assert.equal(patternOf("https://shop.test/product/1"), patternOf("https://shop.test/product/2"));
    assert.equal(patternOf("https://shop.test/product/1"), "https://shop.test/product/{}");
  });

  it("handles the identifiers real applications use", () => {
    const uuid = "https://shop.test/order/3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const hex = "https://shop.test/order/a1b2c3d4e5f6";
    const slug = "https://shop.test/item/blue-shirt-4821";
    assert.equal(patternOf(uuid), "https://shop.test/order/{}");
    assert.equal(patternOf(hex), "https://shop.test/order/{}");
    assert.equal(patternOf(slug), "https://shop.test/item/{}");
  });

  it("keeps genuinely different pages apart", () => {
    assert.notEqual(patternOf("https://shop.test/cart"), patternOf("https://shop.test/checkout"));
    // A word is not an identifier, however short.
    assert.equal(patternOf("https://shop.test/about"), "https://shop.test/about");
  });

  it("treats which filters are used as structure and their values as data", () => {
    assert.equal(
      patternOf("https://shop.test/search?q=shoes&page=2"),
      patternOf("https://shop.test/search?q=hats&page=9"),
    );
    assert.notEqual(
      patternOf("https://shop.test/search?q=shoes"),
      patternOf("https://shop.test/search?q=shoes&sort=price"),
    );
  });

  it("sees two product pages as the same shape despite every word differing", () => {
    const first = [
      { role: "heading", kind: "text", how: "role" },
      { role: "button", kind: "control", how: "role" },
      { role: "link", kind: "link", how: "role" },
    ];
    const second = [
      { role: "heading", kind: "text", how: "role" },
      { role: "button", kind: "control", how: "testId" },
      { role: "link", kind: "link", how: "role" },
    ];
    // Names are not in the shape, and neither is how a selector was found.
    assert.equal(shapeOf(first), shapeOf(second));
  });

  it("sees a different set of controls as a different shape", () => {
    const page = [{ role: "button", kind: "control", how: "role" }];
    const form = [
      { role: "textbox", kind: "input", how: "role" },
      { role: "button", kind: "control", how: "role" },
    ];
    assert.notEqual(shapeOf(page), shapeOf(form));
  });
});
