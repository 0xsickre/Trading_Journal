# rollback/

Ručni skriptovi za povratak unazad. **Ništa ovde se ne pušta automatski.**

Zašto van `migrations/`: fajl koji tamo počinje istim vremenskim pečatom kao migracija koju poništava
Supabase CLI vidi kao drugu migraciju sa istom verzijom — u najboljem slučaju sudar, u najgorem
poništavanje tek primenjene izmene pri sledećem `db push`.

Zašto uopšte postoje: migracije ovog repoa se puštaju direktno na glavnu bazu. Nepovratna izmena nad
živom knjigom nije izmena nego opklada, pa svaka migracija koja dodaje tabele ili sužava CHECK treba
da ima zapisan put nazad — makar samo da bi se videlo **šta bi povratak uništio** pre nego što se
odluči da se ne vraća.

Svaki skript kaže u zaglavlju šta briše i kada ga **ne** treba pokretati.
