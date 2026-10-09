-- Faza W: koliko je dobitniku trebalo da krene (trejder, 09.10.2026, odluka W1-A).
--
-- ZAŠTO. Trejder hoće vremenski stop iz sopstvene istorije: ako dobitnici krenu za N minuta, trejd
-- koji do tada nije krenuo seče se pre SL-a. `time_underwater_pct` kaže KOLIKI deo trejda je bio u
-- minusu, ne KADA je trejd poslednji put bio u minusu.
--
-- ŠTA. `last_underwater_seconds` = sekunde od prvog ulaza do kraja POSLEDNJEG trenutka u kome je
-- tekući P&L (ostvareno na izlazima + otvoreni ugovori po ceni, bez provizije) bio ispod nule. Kod
-- dobitnika je to „krenuo u smeru“: od tada u plusu i nikad više ispod ulaza (W1-A). Nikad pod
-- vodom = 0; gubitnik završava pod vodom, pa je ≈ trajanje (journal ga tu ne čita). Piše ga samo
-- `futures-trading` `journal_mae.py`, iz istih R2 sveća i u istom upisu kao `time_underwater_pct`;
-- aplikacija ga samo čita. NULL = nije izmereno.

ALTER TABLE public.tj_positions
  ADD COLUMN IF NOT EXISTS last_underwater_seconds numeric;

ALTER TABLE public.tj_positions DROP CONSTRAINT IF EXISTS tj_positions_last_underwater_seconds_check;
ALTER TABLE public.tj_positions
  ADD CONSTRAINT tj_positions_last_underwater_seconds_check
  CHECK (last_underwater_seconds IS NULL OR last_underwater_seconds >= 0);

COMMENT ON COLUMN public.tj_positions.last_underwater_seconds IS
  'Sekunde od prvog ulaza do kraja poslednjeg trenutka sa tekućim P&L < 0, iz R2 sveća (futures-trading journal_mae.py, faza W). Dobitnik: vreme do trajnog plusa. NULL = nije izmereno.';
