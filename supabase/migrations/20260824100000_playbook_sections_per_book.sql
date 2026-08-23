-- Sekcija pripada PLAYBOOK-u, a ne nalogu.
--
-- Tri žalbe, jedan koren. Nov playbook je crtao sve sekcije koje nalog ima,
-- prazne ili ne; sekcija se nije mogla obrisati jer je neko pravilo iz DRUGE
-- knjige stajalo pod istim imenom; i isto pravilo je moralo da stoji u istoj
-- sekciji u svakoj knjizi. Sve troje sledi iz toga što su sekcija (jedna
-- `rule_category` opciona lista po nalogu) i veza pravila sa njom
-- (`tj_playbook_rules.category`) bile GLOBALNE.
--
-- Model veze je već bio tačan: pravilo je biblioteka sa jednim `id`-jem, veza je
-- zaseban red, `sort_order` stoji na vezi pa isto pravilo može biti treće u
-- jednoj knjizi i prvo u drugoj. Falila su mu dva stupca.
--
-- ŠTA SE SELI, I ZAŠTO BAŠ TO
--
--   sekcija            → nova tabela, po playbook-u
--   veza sa sekcijom   → `tj_playbook_rule_links.section_id`
--   is_setup_criterion → `tj_playbook_rule_links` (isti razlog: koje pravilo
--                        ocenjuje setup je stvar KNJIGE — `criteriaByPlaybook`
--                        u `rule-lookup.ts` to već računa po knjizi, samo je
--                        izvodio iz globalne zastavice)
--
--   show_when          → OSTAJE na pravilu. Odgovori (`tj_position_rules`) vise
--                        o `rule_id`, a `show_when` određuje imenilac follow
--                        rate-a. Po knjizi bi isto pravilo imalo dva imenioca
--                        nad jednim skupom odgovora.
--
-- Nema više stabilnog `value`: veza pokazuje na `section_id` (uuid), pa je
-- preimenovanje sekcije besplatno i ne dira nijedno pravilo.

-- 1) Tabela ------------------------------------------------------------------

CREATE TABLE public.tj_playbook_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playbook_id uuid NOT NULL REFERENCES public.tj_playbooks(id) ON DELETE CASCADE,

  label text NOT NULL CHECK (btrim(label) <> ''),

  -- Rečenica pored naslova. Nekad `RULE_CATEGORY_HINTS`, konstanta ključevana
  -- po pet vrednosti koje ovaj repo seje — pa je sekcija koju je korisnik sam
  -- izmislio ostajala bez ijedne, a preimenovana je zadržavala rečenicu
  -- napisanu za reč koja se više ne koristi.
  description text,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dva naslova sa istim imenom u istoj knjizi bi crtala dve kartice nad istim
-- pitanjem. Normalizovano, jer se „Entry" i „entry " razlikuju samo za mašinu.
CREATE UNIQUE INDEX tj_playbook_sections_book_label_idx
  ON public.tj_playbook_sections (playbook_id, lower(btrim(label)));

CREATE INDEX tj_playbook_sections_book_order_idx
  ON public.tj_playbook_sections (playbook_id, sort_order, id);

ALTER TABLE public.tj_playbook_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY tj_playbook_sections_owner ON public.tj_playbook_sections
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.tj_playbook_sections IS
  'Naslov unutar JEDNOG playbook-a. Nasleđuje `rule_category` opcionu listu, '
  'koja je bila jedna za ceo nalog i time uslovljavala svaki playbook svakim drugim.';

-- 2) Prenos zatečenih sekcija ------------------------------------------------
--
-- Pravi se sekcija samo za par (playbook, kategorija) koji STVARNO postoji među
-- vezama. Sekcije koje danas stoje prazne u nekoj knjizi se namerno ne prenose —
-- to je cela poenta: playbook ima samo sekcije koje koristi.
--
-- Labela se razrešava kao i na ekranu: korisnikova iz `tj_option_items`, pa
-- ugrađena za pet sejanih vrednosti (`RULE_CATEGORY_LABELS`), pa sama vrednost.
-- Grupiše se po RAZREŠENOJ labeli a ne po `category`, jer dve vrednosti mogu da
-- se razreše u isto ime i razbile bi jedinstveni indeks iznad.

WITH pairs AS (
  SELECT DISTINCT
    l.user_id,
    l.playbook_id,
    COALESCE(
      oi.label,
      CASE r.category
        WHEN 'context'    THEN 'Context'
        WHEN 'entry'      THEN 'Entry'
        WHEN 'management' THEN 'Management'
        WHEN 'exit'       THEN 'Exit'
        WHEN 'no_trade'   THEN 'No-trade'
        ELSE r.category
      END
    ) AS label,
    oi.description AS description,
    -- Bez ordinala u listi (arhivirana ili obrisana stavka) ide na kraj.
    COALESCE(oi.sort_order, 1000) AS sort_order
  FROM public.tj_playbook_rule_links l
  JOIN public.tj_playbook_rules r ON r.id = l.rule_id
  LEFT JOIN public.tj_option_lists ol
    ON ol.user_id = l.user_id AND ol.key = 'rule_category'
  LEFT JOIN public.tj_option_items oi
    ON oi.list_id = ol.id AND oi.value = r.category
),
folded AS (
  SELECT
    user_id,
    playbook_id,
    lower(btrim(label)) AS norm,
    min(label) AS label,
    min(description) AS description,
    min(sort_order) AS sort_order
  FROM pairs
  GROUP BY user_id, playbook_id, lower(btrim(label))
)
INSERT INTO public.tj_playbook_sections (user_id, playbook_id, label, description, sort_order)
SELECT
  user_id,
  playbook_id,
  label,
  description,
  -- Prenumerisano po knjizi: ordinali su dolazili iz jedne zajedničke liste, pa
  -- bi knjiga koja koristi prvu i petu sekciju dobila 0 i 4.
  (row_number() OVER (PARTITION BY playbook_id ORDER BY sort_order, label))::int - 1
FROM folded;

-- 3) Stubovi na vezi ---------------------------------------------------------

ALTER TABLE public.tj_playbook_rule_links
  ADD COLUMN section_id uuid REFERENCES public.tj_playbook_sections(id) ON DELETE CASCADE,
  ADD COLUMN is_setup_criterion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tj_playbook_rule_links.section_id IS
  'Sekcija U TOJ KNJIZI. Isto pravilo sme da stoji pod „Entry" u jednoj i pod „Izlaz" u drugoj.';

COMMENT ON COLUMN public.tj_playbook_rule_links.is_setup_criterion IS
  'Da li pravilo ocenjuje KVALITET SETUP-a u ovoj knjizi. Bilo na pravilu, pa je '
  'isto pravilo moralo da ocenjuje svuda ili nigde.';

-- Ista računica labele kao gore, pa spoj po normalizovanom imenu.
WITH resolved AS (
  SELECT
    l.id AS link_id,
    l.playbook_id,
    lower(btrim(COALESCE(
      oi.label,
      CASE r.category
        WHEN 'context'    THEN 'Context'
        WHEN 'entry'      THEN 'Entry'
        WHEN 'management' THEN 'Management'
        WHEN 'exit'       THEN 'Exit'
        WHEN 'no_trade'   THEN 'No-trade'
        ELSE r.category
      END
    ))) AS norm
  FROM public.tj_playbook_rule_links l
  JOIN public.tj_playbook_rules r ON r.id = l.rule_id
  LEFT JOIN public.tj_option_lists ol
    ON ol.user_id = l.user_id AND ol.key = 'rule_category'
  LEFT JOIN public.tj_option_items oi
    ON oi.list_id = ol.id AND oi.value = r.category
)
UPDATE public.tj_playbook_rule_links l
   SET section_id = s.id
  FROM resolved v
  JOIN public.tj_playbook_sections s
    ON s.playbook_id = v.playbook_id
   AND lower(btrim(s.label)) = v.norm
 WHERE l.id = v.link_id;

UPDATE public.tj_playbook_rule_links l
   SET is_setup_criterion = r.is_setup_criterion
  FROM public.tj_playbook_rules r
 WHERE r.id = l.rule_id;

-- Pada glasno ako je ijedna veza ostala bez sekcije. `category` je NOT NULL a
-- FK garantuje da pravilo postoji, pa se labela uvek razreši — ali ovo je
-- poslednja tačka na kojoj bi promašaj bio popravljiv, umesto da se pojavi kao
-- prazna kartica mesecima kasnije.
ALTER TABLE public.tj_playbook_rule_links
  ALTER COLUMN section_id SET NOT NULL;

CREATE INDEX tj_playbook_rule_links_section_idx
  ON public.tj_playbook_rule_links (section_id, sort_order, id);

-- 4) „Kriterijum mora biti always" seli se sa zastavicom ---------------------
--
-- CHECK više ne može: zastavica je na vezi, `show_when` na pravilu. Isto pravilo
-- sa dve strane, pa dva okidača.
--
-- Zašto uopšte: kriterijum koji se pita samo za dobitnike ocenjivao bi setup
-- već znajući ishod — a to je tačno ono što ocena postoji da izbegne.

CREATE OR REPLACE FUNCTION public.tj_link_criterion_always()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.is_setup_criterion
     and (select show_when from public.tj_playbook_rules where id = new.rule_id) <> 'always'
  then
    raise exception
      'Only a rule that shows on every trade can grade the setup (rule %).', new.rule_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE TRIGGER tj_playbook_rule_links_criterion_always
  BEFORE INSERT OR UPDATE OF is_setup_criterion, rule_id
  ON public.tj_playbook_rule_links
  FOR EACH ROW EXECUTE FUNCTION public.tj_link_criterion_always();

CREATE OR REPLACE FUNCTION public.tj_rule_show_when_vs_criterion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.show_when is distinct from old.show_when
     and new.show_when <> 'always'
     and exists (
       select 1 from public.tj_playbook_rule_links
        where rule_id = old.id and is_setup_criterion
     )
  then
    raise exception
      'Rule % grades the setup in at least one playbook, so it must show on every trade.',
      old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE TRIGGER tj_playbook_rules_show_when_vs_criterion
  BEFORE UPDATE OF show_when ON public.tj_playbook_rules
  FOR EACH ROW EXECUTE FUNCTION public.tj_rule_show_when_vs_criterion();

-- 5) Pravilo gubi ono što nikad nije bilo njegovo -----------------------------
--
-- `tj_playbook_rules_criterion_always` CHECK odlazi sa stupcem.

ALTER TABLE public.tj_playbook_rules
  DROP COLUMN category,
  DROP COLUMN is_setup_criterion;

-- `sort_order` je bio numerisan unutar kategorije, koje više nema — pa su se
-- ordinali iz različitih kategorija poklapali i redosled biblioteke zavisio od
-- `id` tiebreak-a. Prenumeracija zadržava zatečeni raspored, samo ga
-- razjednačuje.
WITH ordered AS (
  SELECT id, (row_number() OVER (PARTITION BY user_id ORDER BY sort_order, id))::int - 1 AS ord
  FROM public.tj_playbook_rules
)
UPDATE public.tj_playbook_rules r
   SET sort_order = o.ord
  FROM ordered o
 WHERE o.id = r.id
   AND r.sort_order IS DISTINCT FROM o.ord;

-- 6) Stara lista odlazi -------------------------------------------------------
--
-- Posle koraka 2 nema više čitaoca: sekcije su prenete u `tj_playbook_sections`
-- sa imenom, opisom i redosledom. Ostavljena bi bila lista koju Settings već
-- krije a nijedan ekran ne otvara — mrtav red koji sledeći čitalac mora da
-- istraži da bi saznao da je mrtav.

DELETE FROM public.tj_option_items i
 USING public.tj_option_lists l
 WHERE l.id = i.list_id AND l.key = 'rule_category';

DELETE FROM public.tj_option_lists WHERE key = 'rule_category';
