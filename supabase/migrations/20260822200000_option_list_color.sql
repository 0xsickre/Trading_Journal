-- A category carries its own colour.
--
-- Colour already existed one level down, on `tj_option_items`, because that is
-- where it started: a per-tag dot. Tags management makes the CATEGORY the thing
-- you name, colour and file tags under — the tag inherits its category's colour
-- rather than choosing one — so the column belongs here too.
--
-- Item-level `color` stays and keeps working. Nothing reads one in place of the
-- other; the category colour is what the category row and the tag's category
-- chip render, and an item that already carries its own colour still shows it.

ALTER TABLE public.tj_option_lists
  ADD COLUMN IF NOT EXISTS color text;

COMMENT ON COLUMN public.tj_option_lists.color IS
  'Hex colour for the category chip. NULL means "no colour chosen", which the UI renders as a neutral dot rather than inventing one.';
