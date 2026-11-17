/** Portable SHA-256 shared by immutable backend records and their projections. */
export function hashText(value: string): string {
  const bytes = new TextEncoder().encode(value),
    length = bytes.length,
    padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(bytes);
  padded[length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, length * 8);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  const constants: number[] = [],
    initial: number[] = [];
  for (let n = 2; constants.length < 64; n++) {
    let prime = true;
    for (let p = 2; p * p <= n; p++)
      if (n % p === 0) {
        prime = false;
        break;
      }
    if (prime) {
      if (initial.length < 8) initial.push(((Math.sqrt(n) % 1) * 0x100000000) | 0);
      constants.push(((Math.cbrt(n) % 1) * 0x100000000) | 0);
    }
  }
  const h = initial,
    w = new Int32Array(64),
    r = (v: number, n: number) => (v >>> n) | (v << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      w[i] =
        (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) +
        w[i - 16] +
        (r(b, 17) ^ r(b, 19) ^ (b >>> 10)) +
        w[i - 7];
    }
    let [a, b, c, d, e, f, g, z] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
          (z + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + w[i]) | 0,
        t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      z = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, z].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

export const stableContent = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(stableContent).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.entries(value)
          .filter(([, child]) => child !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => JSON.stringify(key) + ":" + stableContent(child))
          .join(",") +
        "}"
      : (JSON.stringify(value) ?? "null");
