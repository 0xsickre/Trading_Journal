-- `playbooks_expanded` odlazi: niko je ne piše i niko je ne čita.
--
-- Kolona je pamtila koje su kartice na `/playbooks` bile raširene, dok je ta
-- stranica bila spisak kartica koje se otvaraju. Otkad je postala kompaktna
-- tabela sa zasebnom stranicom po playbook-u, nema šta da se širi — pa je i
-- akcija koja je pisala u nju (`setPlaybooksExpanded`) ostala bez pozivaoca, i
-- `getUserPrefs` je čitao vrednost koju nijedan ekran ne gleda.
--
-- Zadržana kolona ne košta upit, ali košta sledećeg čitaoca: `tj_user_prefs` je
-- mesto na kom se traži „gde se pamti ovo podešavanje", a stubac bez ijednog
-- pisca je odgovor koji nije tačan.
--
-- Bezbedno je jer je čisto UI stanje: ni jedan trejd, ni jedna statistika, ni
-- jedno pravilo ne zavise od nje. Ako se raširene kartice ikad vrate, vraća se
-- i kolona — praznog sadržaja, što je tačno stanje u kom bi i danas bila.

ALTER TABLE public.tj_user_prefs
  DROP COLUMN IF EXISTS playbooks_expanded;
