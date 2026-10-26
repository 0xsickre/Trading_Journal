<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Current work: swing → day trading

The journal moved from a swing book (FTMO CFDs) to intraday CME futures, and since phase X
(26.10.2026) it knows no prop firm: no firm's rules are computed here (the trader keeps them on each
platform), and the tracker measures process only. Phase B (quick entry, the day closed on /daily)
followed. The plan, its phases, the decisions already taken and the next step (X-10, the brief in
`futures-trading`, which unblocks X6) live in
**[`FAZA_F_DAYTRADING_PLAN.md`](FAZA_F_DAYTRADING_PLAN.md)** (Serbian). Before any change that
touches trading logic, read it and follow its section "Kako nastaviti": do only the first phase
whose status is not ✅, write that phase's detailed plan first if it has none, and ask the trader
instead of guessing any decision the plan lists as open. `README.md` must stay 1:1 with the code.
