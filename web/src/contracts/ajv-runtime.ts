// Runtime helpers referenced by the precompiled validators (generated/validators.js).
// Imported through one shim so CommonJS interop is resolved in exactly one place.
import * as ucs2lengthModule from "ajv/dist/runtime/ucs2length.js";
import * as formatsModule from "ajv-formats/dist/formats.js";

type Fn = (s: string) => number;

function unwrap<T>(m: unknown, key: string): T {
  let cur = m as Record<string, unknown>;
  for (let i = 0; i < 3 && cur && !(key in cur) && "default" in cur; i++) cur = cur.default as Record<string, unknown>;
  return cur[key] as T;
}

const ucs = ucs2lengthModule as unknown as { default: Fn | { default: Fn } };
export const ucs2length: Fn = typeof ucs.default === "function" ? ucs.default : ucs.default.default;
export const fullFormats = unwrap<Record<string, unknown>>(formatsModule, "fullFormats");
