-- Redni broj trejda se sam dodeljuje.
--
-- Do sada je `trade_no` bilo obično polje u formi: korisnik ga je kucao. To ima
-- tri posledice koje se sve svode na isto — broj koji identifikuje trejd nije
-- smeo da zavisi od toga da li se čovek seti šta je bio poslednji:
--
--   1. Preskočeni i ponovljeni brojevi. Ništa ih nije sprečavalo, a `#14` se
--      pojavljuje u navigaciji (`daily/page.tsx:142`), u notebook izboru
--      (`notebook/page.tsx:24`), u tracker porukama (`auto-rules.ts:90`) i u
--      izvozu (`journal-grid.tsx:576`). Dva trejda pod istim brojem čine te
--      oznake dvosmislenim.
--   2. Uvezeni trejdovi nisu dobijali broj UOPŠTE — `commitImport` ga ne piše,
--      pa je svaki uvezen red ostajao na NULL i prikazivao se kao skraćeni UUID.
--   3. Prazno polje na svakoj novoj formi, koje traži da se popuni a nema šta da
--      ponudi.
--
-- OPSEG NUMERACIJE
--
-- Po nalogu, ne po korisniku. Dva naloga su dve knjige; „trejd #14" na demo
-- nalogu i „#14" na živom su različiti trejdovi i tako i treba da se broje.
-- `IS NOT DISTINCT FROM` grupiše i trejdove bez naloga u svoj niz umesto da ih
-- `= NULL` izbaci iz svakog poređenja.
--
-- ZAKLJUČAVANJE
--
-- `max(trade_no) + 1` pročitan iz dva paralelna INSERT-a daje isti broj oboma.
-- Za jednokorisnički žurnal to je malo verovatno, ali uvoz od dvesta redova je
-- upravo situacija u kojoj se „malo verovatno" dešava. `pg_advisory_xact_lock`
-- serijalizuje dodelu po nalogu i pušta lock sam na kraju transakcije.
--
-- Ručno upisan broj se POŠTUJE. Trigger popunjava samo ono što je NULL, pa
-- postojeći trejdovi zadržavaju svoje brojeve, a uvoz starih podataka koji nose
-- brokerov broj tiketa može da ga zadrži.

CREATE OR REPLACE FUNCTION public.tj_assign_trade_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if new.trade_no is not null then
    return new;
  end if;

  -- Ključ zaključavanja je par (korisnik, nalog), sveden na dva int4 koja
  -- `pg_advisory_xact_lock` prima. `hashtext` na NULL nalogu daje NULL, pa
  -- coalesce na prazan string drži i tu granu u istom nizu.
  perform pg_advisory_xact_lock(
    hashtext(new.user_id::text),
    hashtext(coalesce(new.account_id::text, ''))
  );

  select coalesce(max(p.trade_no), 0) + 1
    into new.trade_no
    from public.tj_positions p
   where p.user_id = new.user_id
     and p.account_id is not distinct from new.account_id;

  return new;
end;
$function$;

COMMENT ON FUNCTION public.tj_assign_trade_no() IS
  'Assigns the next per-account trade number when none was supplied. Advisory '
  'lock serialises concurrent inserts so a batch import cannot hand two rows '
  'the same number.';

DROP TRIGGER IF EXISTS tj_positions_assign_trade_no ON public.tj_positions;
CREATE TRIGGER tj_positions_assign_trade_no
  BEFORE INSERT ON public.tj_positions
  FOR EACH ROW EXECUTE FUNCTION public.tj_assign_trade_no();

REVOKE ALL ON FUNCTION public.tj_assign_trade_no() FROM PUBLIC, anon, authenticated;

-- Postojeći trejdovi bez broja dobijaju ga po redosledu nastanka, po nalogu.
-- `created_at, id` a ne samo `created_at`: dva reda upisana u istoj milisekundi
-- inače bi dobila proizvoljan poredak, pa bi ista migracija puštena dvaput dala
-- različite brojeve.
WITH numbered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, account_id
           ORDER BY created_at, id
         ) AS n
    FROM public.tj_positions
   WHERE trade_no IS NULL
)
UPDATE public.tj_positions p
   SET trade_no = numbered.n
  FROM numbered
 WHERE p.id = numbered.id;
