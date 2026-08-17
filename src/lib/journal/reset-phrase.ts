/**
 * The phrase that has to be typed to wipe the book.
 *
 * Its own module because a `"use server"` file may only export async functions —
 * a plain `export const` there is a build error, not a style question. Shared so
 * the dialog and the server action check the same string; two copies would drift
 * and the dialog would start accepting a phrase the server rejects.
 */
export const RESET_PHRASE = "RESET EVERYTHING";
