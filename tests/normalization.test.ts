import { expect, it } from "vitest";
import { normalizeClientDirectives } from "../src/server/generation/normalize";
it("repairs the observed unquoted directive and preserves valid directives and CSS", () => {
  const result = normalizeClientDirectives({
    "app/page.tsx": 'use client;\nimport { useState } from "react";',
    "app/components/card.tsx":
      "'use client';\nexport default function Card(){}",
    "app/globals.css": "use client;\nbody{}",
  });
  expect(result.corrected).toBe(true);
  expect(result.files["app/page.tsx"]).toMatch(/^"use client";/);
  expect(result.files["app/components/card.tsx"]).toMatch(/^'use client';/);
  expect(result.files["app/globals.css"]).toMatch(/^use client;/);
});
