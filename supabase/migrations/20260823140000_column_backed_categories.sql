-- Pet kategorija koje su živele u kodu dobijaju svoj red.
--
-- `technical_tags`, `mistake`, `psychology_tags`, `exit_reason` i `miss_reason`
-- bile su deklarisane u `form-config.ts` a ne u `tj_field_defs`, jer svaka od
-- njih ima pravu kolonu na `tj_positions` koju izveštaji, grid i CSV izvoz čitaju
-- po imenu. Posledica se videla u Settings-u: nisu imale ni fazu, ni izbor
-- jedan/više — samo preimenovanje i boju, dok je svaka druga kategorija imala
-- sve troje.
--
-- Sad imaju red kao i sve ostale. Skladište se NE seli: `column-backed-fields.ts`
-- drži isti spisak i označava ta polja `custom: false`, pa put upisa i dalje
-- piše u kolonu. Čitanje i upis se time konačno slažu — `fieldValue` ionako
-- gleda kolonu pre `custom` bag-a, i upravo taj raskorak je bio zamka zbog koje
-- `RESERVED_KEYS` postoji.
--
-- `RESERVED_KEYS` ostaje netaknut: korisnik i dalje ne sme da NAZOVE svoju
-- kategoriju po koloni. Ovih pet nije napravio korisnik.
--
-- FAZE su ono što je grupa nekad nagoveštavala a nikad nije umela da kaže:
--   miss_reason      → missed   (plan koji nikad nije otvoren)
--   exit_reason      → active   (razlog izlaska postoji tek kad se izašlo)
--   mistake          → active
--   psychology_tags  → active   (osvrt posle ishoda)
--   technical_tags   → always   (čita se pre ulaska, gleda se na reviziji)
--
-- TIPOVI prate ono što je forma već crtala, da se ponašanje ne promeni ispod
-- korisnika: `select` za `exit_reason` i `miss_reason`, `tags` za ostala tri.
--
-- `list_key` za `psychology_tags` je `emotion`. Kolonu pune DVE kategorije
-- (`emotion` i `discipline`) i model to ne izražava — jedan red nosi jedan
-- `list_key`. Vezuje se za `emotion` da bi kategorija imala gde da nosi svoju
-- fazu i tip, a forma i dalje spaja obe liste u ponudu. To je jedina od pet
-- koja ostaje delimično poseban slučaj, i zapisano je ovde da se ne otkriva
-- ponovo.

INSERT INTO public.tj_field_defs
  (user_id, key, label, field_type, list_key, show_phase, sort_order)
SELECT
  u.user_id,
  v.key,
  v.label,
  v.field_type,
  v.list_key,
  v.show_phase,
  -- Iza svih postojećih, u redosledu iz `v`. Prevlačenje ih dalje pomera.
  COALESCE(
    (SELECT MAX(d.sort_order) FROM public.tj_field_defs d WHERE d.user_id = u.user_id),
    -1
  ) + v.ord
FROM (SELECT DISTINCT user_id FROM public.tj_option_lists) u
CROSS JOIN (VALUES
  ('technical_tags',  'Technical Tags',  'tags',   'technical_tag', 'always', 1),
  ('exit_reason',     'Exit Reason',     'select', 'exit_reason',   'active', 2),
  ('mistake',         'Mistake',         'tags',   'mistake',       'active', 3),
  ('psychology_tags', 'Psychology tags', 'tags',   'emotion',       'active', 4),
  ('miss_reason',     'Miss Reason',     'select', 'miss_reason',   'missed', 5)
) AS v(key, label, field_type, list_key, show_phase, ord)
-- Idempotentno kroz jedinstveni indeks (user_id, key): ponovno pokretanje ne
-- pravi duplikat, a red koji je korisnik u međuvremenu preimenovao ostaje njegov.
ON CONFLICT (user_id, key) DO NOTHING;
