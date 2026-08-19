-- Ocena izvršenja, 1–5. Vraćanje onoga što je `20260801180000_drop_position_rating`
-- obrisao — pod uslovom koji je ta migracija sama postavila.
--
-- Njen tekst glasi: „Ako ocena izvršenja jednog dana zatreba, vraća se jednim
-- ALTER-om i jednim unosom u `plan_review`/`psychology_notes` grupu forme — UZ
-- UI KOJI JE STVARNO POSTAVLJA, što je deo koji je ovde nedostajao."
--
-- Taj UI stiže u ISTOM commit-u kao ova migracija: `StarRating` komponenta u
-- `psychology_notes` grupi. Stara `rating` kolona je bila mrtva jer je nijedan
-- deo forme nije upisao; ova se ne pušta bez polja koje je upisuje.
--
-- ZAŠTO `execution_rating`, A NE `rating`: tabela već nosi dve ocene —
-- `conviction` (koliko si verovao PRE ulaza) i `setup_grade` (koliko je setup
-- bio dobar). Ime mora da kaže ŠTA se ocenjuje, inače treća „ocena" bez
-- prideva tera čitaoca da pogađa. Ovo je koliko si dobro ODIGRAO, sudi se
-- POSLE trejda i nezavisno od toga da li je bio profitabilan — gubitnik odigran
-- po planu zaslužuje 5.
--
-- NULL je dozvoljen i biće čest: ocena je subjektivna i ne traži se ni na
-- jednom uvezenom trejdu. „Nije ocenjeno" ≠ „1 zvezdica", i cela komponenta je
-- napravljena da tu razliku održi — klik na već postavljenu zvezdicu vraća na
-- NULL.
--
-- CHECK je ogledalo `tj_positions_conviction_check`, do imena.

alter table public.tj_positions
  add column if not exists execution_rating smallint;

alter table public.tj_positions
  drop constraint if exists tj_positions_execution_rating_check;

alter table public.tj_positions
  add constraint tj_positions_execution_rating_check
  check (execution_rating is null or (execution_rating >= 1 and execution_rating <= 5));

comment on column public.tj_positions.execution_rating is
  'Koliko je trejd dobro ODIGRAN, 1–5, subjektivno i posle izlaska. NULL = nije ocenjeno, što nije isto što i 1.';
