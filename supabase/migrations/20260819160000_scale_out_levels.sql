-- Strukturirani scale-out nivoi, pored slobodnog teksta koji ostaje.
--
-- ODLUKA DONETA UPRKOS PODACIMA, i to mora da stoji ovde umesto izmišljenog
-- dokaza. `20260813180000_scale_out_plan` je postavila uslov: „Structure it
-- later IF THE NOTES TURN OUT TO HAVE A SHAPE." Izmereno pre pisanja ove
-- migracije: `scale_out_plan` je popunjen na 0 od 82 trejda. Uslov NIJE
-- ispunjen.
--
-- Vlasnik je svejedno odlučio da se gradi, sa obrazloženjem da je polje prazno
-- ZATO ŠTO JE TEXTAREA I TRAŽI PROZU — niko ne piše rečenicu da bi zabeležio
-- „60 % na 1R" — a ne zato što se izlazi ne skaliraju. To je hipoteza, ne
-- nalaz, i ova migracija je tako i beleži. Ako i strukturirani editor ostane
-- prazan posle 30-40 trejdova, hipoteza je oborena i kolona se briše.
--
-- OBE KOLONE OSTAJU. `scale_out_plan` je netaknut: plan koji ima oblik ide u
-- redove, plan koji ga nema ostaje rečenica („rest to target once London
-- closes" nije tabela). Nova kolona ne zamenjuje staru nego joj daje oblik
-- kad ga ima.
--
-- ZAŠTO jsonb A NE TABELA-DETE: nivoi nemaju identitet nezavisan od pozicije,
-- nijedan pogled ih ne agregira preko pozicija, a tabela bi tražila peti
-- argument u `tj_save_trade` — jedinoj funkciji koja sada upija svaku promenu
-- šeme bez izmene, jer kolone gradi iz `information_schema`.
--
-- CENA KOJU PRIZNAJEMO: pravilo „zbir procenata ≤ 100" ne može u CHECK —
-- set-returning funkcije (`jsonb_array_elements`) tamo nisu dozvoljene. Živi u
-- TypeScript-u (`scale-out.ts`) i blokira snimanje. Baza brani samo OBLIK: da
-- je vrednost niz.
--
-- NOT NULL DEFAULT '[]' bez `IS NULL OR` grane, isti dogovor koji `custom`
-- (jsonb) i tag nizovi već nose: nema NULL-a da se brani.

alter table public.tj_positions
  add column if not exists scale_out_levels jsonb not null default '[]'::jsonb;

alter table public.tj_positions
  drop constraint if exists tj_positions_scale_out_levels_check;

alter table public.tj_positions
  add constraint tj_positions_scale_out_levels_check
  check (jsonb_typeof(scale_out_levels) = 'array');

comment on column public.tj_positions.scale_out_levels is
  'Planirani nivoi izlaska: [{"pct": 60, "price": 1.0850}, …]. Cena, ne R — R se izvodi iz entry/stop. Zbir ≤ 100 se proverava u TS-u, ne ovde.';
