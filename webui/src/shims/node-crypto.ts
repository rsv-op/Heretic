// Browser implementation of the node:crypto functions used by the backend.
// scrypt parameters match Node's scryptSync defaults (N=16384, r=8, p=1), so
// password hashes created by the Next.js server verify here and vice versa.
import { Buffer } from "buffer";
import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes as randomBytesArray } from "@noble/hashes/utils";

export function randomBytes(size: number) {
  return Buffer.from(randomBytesArray(size));
}

export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported hash: ${algorithm}`);
  const chunks: Uint8Array[] = [];
  const hash = {
    update(input: string | Uint8Array) {
      chunks.push(typeof input === "string" ? new TextEncoder().encode(input) : input);
      return hash;
    },
    digest(encoding: "hex") {
      const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      return Buffer.from(sha256(joined)).toString(encoding);
    },
  };
  return hash;
}

export function scryptSync(password: string, salt: string, keylen: number) {
  return Buffer.from(scrypt(password, salt, { N: 16384, r: 8, p: 1, dkLen: keylen }));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new RangeError("Input buffers must have the same length");
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
