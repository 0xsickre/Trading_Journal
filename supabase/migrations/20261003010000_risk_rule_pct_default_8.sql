-- Podrazumevani rizik po trejdu: 8 % prostora iznad MLL-a (trejder, 03.10.2026: „8 % koristim, 12,5 treba
-- obrisati gde god da piše — to je zastarelo“). Isto kao TOPSTEP_DEFAULT_RISK_PCT u journalu i RIZIK_PCT u
-- futures-trading/tools/brief/racun.py.
--
-- Menja se samo podrazumevana vrednost za NOV nalog. Postojeći nalozi zadržavaju svoj procenat — oba Topstep
-- naloga su već imala 8 (03.10.2026), pa se ni njihov rizik ni broj ugovora ne menja.

ALTER TABLE public.tj_accounts ALTER COLUMN risk_rule_pct SET DEFAULT 8;

COMMENT ON COLUMN public.tj_accounts.risk_rule_pct IS
  'Risk per trade as % of the room above the MLL (the trader''s rule: 8).';
