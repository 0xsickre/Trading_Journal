-- Okidač koji seeduje novog korisnika pada od 19.07.2026, i to tiho.
--
-- `tj_on_auth_user_created` visi na `AFTER INSERT ON auth.users` i jedina joj je
-- svrha da novom nalogu napravi podrazumevanja. Telo je glasilo:
--
--     begin
--       begin
--         perform public.tj_seed_defaults(new.id);
--         perform public.tj_seed_analysis_defaults(new.id);   -- ← ne postoji
--       exception when others then
--         raise warning 'tj_seed_defaults failed for %: %', new.id, sqlerrm;
--       end;
--       return new;
--     end;
--
-- `tj_seed_analysis_defaults` je obrisana u `20260719120000_drop_analysis_module.sql`.
-- Ta migracija je imala i korak 4 — „Patch tj_seed_my_defaults: remove call to
-- tj_seed_analysis_defaults" — i ispravno ga izvela. Ali je promašila DRUGOG
-- pozivaoca, jer `tj_on_auth_user_created` nikad nije bila u repou: napravljena
-- je direktno nad živim projektom, pre nego što je `supabase/migrations/`
-- postojao. Migracija nije mogla da popravi ono što se u kodu nije videlo.
--
-- ZAŠTO JE POSLEDICA GORA NEGO ŠTO IZGLEDA
--
-- Blok sa `EXCEPTION` klauzulom u PL/pgSQL-u je podtransakcija. Kad drugi
-- `perform` baci, poništava se CEO blok — uključujući `tj_seed_defaults` koji je
-- pre toga uspešno prošao. Ne izgubi se dodatak; izgubi se sve.
--
-- Novi korisnik je tako dobijao nalog bez ijednog naloga: bez `tj_accounts`
-- reda, bez instrumenata, bez padajućih listi, bez foldera za beleške, bez
-- tracker pravila. `raise warning` ne prekida registraciju, pa je prijava
-- uspevala i ništa nije ukazivalo da je išta palo.
--
-- Aplikaciju je od toga čuvalo jedino to što `ensureDefaults()` zove
-- `tj_seed_my_defaults()` RPC — ali samo sa početne strane. Korisnik čija je
-- prva navigacija bilo šta drugo (obeležen `/journal`, deep link) zatekao bi
-- praznu aplikaciju. Komentar u `src/lib/journal/ensure-defaults.ts` je uz to
-- tvrdio da su „novi korisnici seedovani na registraciji okidačem" — što nije
-- bilo tačno ni jednom od 19.07.
--
-- IZMERENO, NE ZAKLJUČENO
--
-- Oba tela su puštena nad živim projektom, svako sa svojim test korisnikom
-- ubačenim u `auth.users`, pa su redovi prebrojani i korisnici obrisani:
--
--   telo              tj_accounts  tj_instruments  tj_option_lists  tj_tracker_rules
--   staro (sa pozivom)      0             0                0                0
--   novo                    1            10               13                7
--
-- Nula na svakoj koloni je potvrda podtransakcije: `tj_seed_defaults` je i u
-- starom telu odradio svoje pre nego što je sledeći red bacio, pa da poništenje
-- nije zahvatalo ceo blok, brojevi bi bili isti u oba reda.
--
-- POPRAVKA
--
-- Mrtav poziv izlazi napolje. `tj_seed_defaults` već sam grana na instrumente,
-- foldere, playbook-ove i tracker pravila, pa je jedan poziv sve što treba.
--
-- `EXCEPTION` blok ostaje namerno: registracija ne sme da padne zato što je
-- seed pao. Ali poruka sad kaže i da fallback postoji, da upozorenje u logu ne
-- bi izgledalo kao gubitak podataka.

CREATE OR REPLACE FUNCTION public.tj_on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  begin
    perform public.tj_seed_defaults(new.id);
  exception when others then
    -- Registracija je važnija od seed-a. `tj_seed_my_defaults()` je idempotentan
    -- i pokriva ovog korisnika pri prvom otvaranju početne strane.
    raise warning 'tj_seed_defaults failed for % (fallback: tj_seed_my_defaults): %',
      new.id, sqlerrm;
  end;
  return new;
end;
$function$;

COMMENT ON FUNCTION public.tj_on_auth_user_created() IS
  'Seeds defaults for a newly registered user. Bound to AFTER INSERT ON auth.users. '
  'Failures are warnings, not errors: signup must not depend on seeding, and '
  'ensureDefaults() re-runs the same SQL idempotently on first page load.';

-- Grant-ovi su isti kao za ostale okidačke funkcije: nijedan krajnji korisnik je
-- ne zove direktno, poziva je Postgres kroz okidač.
REVOKE ALL ON FUNCTION public.tj_on_auth_user_created() FROM PUBLIC, anon, authenticated;
