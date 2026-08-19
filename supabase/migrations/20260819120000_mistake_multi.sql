-- Jedna greška po trejdu je bila pretpostavka, ne nalaz.
--
-- `mistake` je do sada bio jedan `text` iz jedne liste — dakle tačno jedna
-- greška po trejdu. Stvarni loš trejd retko ima jednu: ušlo se kasno JER se
-- jurilo, pa se pomerio stop. Prisiljavanje na izbor između njih baca upravo
-- onaj podatak zbog kog polje postoji — koja se greška PONAVLJA — jer svaki put
-- preživi druga.
--
-- `psychology_tags` i `technical_tags` su isti oblik podatka i već su `text[]`.
-- Ovo samo prestaje da tretira grešku kao izuzetak.
--
-- ZAŠTO 'None' POSTAJE PRAZAN NIZ, A NE array['None'] — ovo je nosivo:
-- `filters.ts` iz bucket-a izbacuje samo `EMPTY_BUCKET`. Da je 'None' ostao kao
-- član niza, upit „trejdovi SA greškom" (`isSet`) bio bi tačan za svaki čist
-- trejd — obrnut odgovor na pitanje koje je postavljeno. Prazan niz je jedini
-- zapis koji znači „nema greške" i ponaša se tako u svakom izveštaju.
--
-- Oba pisanja se mapiraju jer su seed-ovana u različitim migracijama.
-- Pogađa 4 stvarna trejda od 82 u trenutku pisanja.

alter table public.tj_positions alter column mistake drop default;

alter table public.tj_positions
  alter column mistake type text[]
  using case
    when mistake is null                                      then '{}'::text[]
    when btrim(mistake) = ''                                  then '{}'::text[]
    when btrim(mistake) in ('None', 'None / Clean execution') then '{}'::text[]
    else array[btrim(mistake)]
  end;

-- NOT NULL DEFAULT '{}' bez `IS NULL OR` grane: nema NULL-a da se brani, isti
-- dogovor koji `psychology_tags` i `technical_tags` već nose.
alter table public.tj_positions
  alter column mistake set default '{}'::text[],
  alter column mistake set not null;

comment on column public.tj_positions.mistake is
  'Greške na trejdu, više njih. Prazan niz = bez greške; ''None'' se NE čuva kao član, vidi migraciju.';

-- Opcija „None" se deaktivira, ne briše. Chip „None" pored chipa „Late entry"
-- je protivrečnost koju picker ne može da spreči, pa se više ne nudi — ali
-- istorijska vrednost mora da ume da imenuje sebe ako se negde zatekne.
update public.tj_option_items i
   set is_active = false
  from public.tj_option_lists l
 where i.list_id = l.id
   and l.key = 'mistake'
   and btrim(i.value) in ('None', 'None / Clean execution');
