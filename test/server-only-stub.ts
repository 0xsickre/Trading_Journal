/**
 * Stand-in for the `server-only` package, which is NOT in `node_modules`.
 *
 * Next aliases `server-only` at build time to a module that throws if it ever
 * reaches a client bundle. Nothing installs it, so outside Next the import is
 * simply unresolvable — and 20 of 43 journal components reach it transitively
 * through the `"use server"` action modules they import. The whole module graph
 * dies before a single component renders.
 *
 * Empty on purpose. Its production job is to fail a client build, which is a
 * bundler concern; under vitest there is no client bundle to protect.
 */
export {};
