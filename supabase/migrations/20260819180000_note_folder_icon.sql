-- Ikonica po folderu beleški.
--
-- Bez CHECK-a namerno. Kurirana lista imena ikonica živi u TypeScript-u
-- (NOTE_FOLDER_ICONS, folder-icons.ts) i menja se bez migracije — isti dogovor
-- kao FieldType/FieldConfig, gde je struktura u kodu a ne u bazi. Baza čuva
-- string; UI odlučuje šta taj string znači, i UI je taj koji sme da doda ili
-- skine ikonicu iz ponude.
--
-- NULL je i dalje ispravna vrednost — svaki folder napravljen pre ove migracije
-- ostaje sa generičkom Folder ikonicom, ne sa greškom.

alter table public.tj_note_folders add column if not exists icon text;

comment on column public.tj_note_folders.icon is
  'Ime lucide-react ikonice iz kurirane liste (vidi NOTE_FOLDER_ICONS u folder-icons.ts). NULL = generička Folder ikonica.';
