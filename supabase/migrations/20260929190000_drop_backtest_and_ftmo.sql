-- H2.5: the backtest kind and the FTMO columns leave the book (decisions
-- 29.09.2026, I2 and I5-A; the trader: "obriši taj backtest nalog slobodno,
-- samo Topstep ostavi").
--
-- WHY. Since H1 the journal is Topstep only. `account_kind` split the book into
-- Live and Backtest for the TradingView replay import, which is gone with this
-- change; the one backtest account, "Backtesting XAUUSD", held no trade, no
-- cash event and no import on 29.09.2026. The eleven `ftmo_*` columns lost
-- their code in H1 and have been read by nothing since. futures-trading's
-- `journal_mae.py` stopped reading `account_kind` first (c72f61d), so the
-- hourly MAE/MFE job does not break on the dropped column.
--
-- ORDER. The empty backtest account first — guarded, so an account that did
-- hold a trade would stay. If it was the default account (`is_active`), the
-- oldest remaining account that is not archived becomes the default, so the
-- pickers still open on one. Then the CHECKs that name the columns, then the
-- columns. No function or view reads any of them (checked in pg_proc/pg_views).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT a.id, a.user_id, a.is_active
      FROM public.tj_accounts a
     WHERE a.account_kind = 'backtest'
       AND NOT EXISTS (SELECT 1 FROM public.tj_positions p WHERE p.account_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM public.tj_import_batches b WHERE b.account_id = a.id)
  LOOP
    DELETE FROM public.tj_accounts WHERE id = r.id;

    IF r.is_active AND NOT EXISTS (
      SELECT 1 FROM public.tj_accounts x WHERE x.user_id = r.user_id AND x.is_active
    ) THEN
      UPDATE public.tj_accounts
         SET is_active = true
       WHERE id = (
         SELECT x.id FROM public.tj_accounts x
          WHERE x.user_id = r.user_id AND x.archived_at IS NULL
          ORDER BY x.created_at, x.id
          LIMIT 1
       );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_account_kind_check;
ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_one_prop_firm;
ALTER TABLE public.tj_accounts DROP CONSTRAINT IF EXISTS tj_accounts_ftmo_daily_loss_basis_check;

ALTER TABLE public.tj_accounts
  DROP COLUMN IF EXISTS account_kind,
  DROP COLUMN IF EXISTS ftmo_mode,
  DROP COLUMN IF EXISTS ftmo_daily_loss_enabled,
  DROP COLUMN IF EXISTS ftmo_daily_loss_pct,
  DROP COLUMN IF EXISTS ftmo_max_loss_enabled,
  DROP COLUMN IF EXISTS ftmo_max_loss_pct,
  DROP COLUMN IF EXISTS ftmo_profit_target_enabled,
  DROP COLUMN IF EXISTS ftmo_profit_target_pct,
  DROP COLUMN IF EXISTS ftmo_min_days_enabled,
  DROP COLUMN IF EXISTS ftmo_min_days,
  DROP COLUMN IF EXISTS ftmo_reset_at,
  DROP COLUMN IF EXISTS ftmo_daily_loss_basis;
