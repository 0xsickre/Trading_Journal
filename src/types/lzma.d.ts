/**
 * LZMA-JS ships no types. Only the one function the Dukascopy reader calls is
 * declared: a synchronous decode of an LZMA "alone" stream, which is the format
 * of Dukascopy's `.bi5` files. It returns the bytes as numbers — signed, so the
 * caller masks each with `& 255` — EXCEPT when the bytes happen to be valid
 * UTF-8, in which case it returns them decoded as a string. Binary candles rarely
 * are, but "rarely" is not "never", so the caller handles both.
 */
declare module "lzma" {
  export function decompress(data: Uint8Array): number[] | string;
}
