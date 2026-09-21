-- Šest polja dnevnog izveštaja koja niko nikad nije pročitao.
--
-- `macro_note` i četiri „Daglasova straha" kao čekboksi, plus `impulse_note`.
-- Pisali su se svakog trgovačkog dana i vraćali na ekran kao četiri značke u
-- mesečnoj listi — i to je sve. Nema dimenzije koja po njima grupiše, nema
-- insight pravila koje ih spaja sa ishodom, nema metrike koja ih broji. Šest
-- polja trenja bez ijednog čitaoca.
--
-- Isto pitanje POSTOJI tamo gde se može izmeriti: `psychology_tags` na trejdu
-- je dimenzija, filter i bucket u izveštaju. Emocija zakačena za trejd se može
-- uporediti sa rezultatom tog trejda; emocija zakačena za dan ne može ni to.
--
-- `mental_temp` OSTAJE, i to je razlika koja nosi ovu migraciju: to je kapija
-- PRE ulaska, ne dnevnik posle njega, i čitaju je i `dimensions.ts` i pravilo
-- `low_mental_temp_entry`. Ostaje i `no_trade_day`.
--
-- Posle ovoga dnevni izveštaj ima dva odgovora: kakva ti je glava i otvaraš li
-- išta novo danas. Sve ostalo što je dan nekad pitao ili je otišlo na poziciju
-- (`tj_position_checkins`) ili u nedeljni osvrt — gde se, za razliku od ovoga,
-- zaista ponovo čita.

ALTER TABLE public.tj_daily_reports
  DROP COLUMN IF EXISTS macro_note,
  DROP COLUMN IF EXISTS impulse_fomo,
  DROP COLUMN IF EXISTS impulse_fear,
  DROP COLUMN IF EXISTS impulse_greed,
  DROP COLUMN IF EXISTS impulse_fear_wrong,
  DROP COLUMN IF EXISTS impulse_note;

COMMENT ON TABLE public.tj_daily_reports IS
  'Pre-market kapija za jedan dan: mentalno stanje i „otvaram li išta novo". '
  'Sve prozno je u 20260813120000 otišlo na poziciju ili u nedeljni osvrt, a '
  'poslednjih šest polja u 20260921160000 — niko ih nije čitao.';
