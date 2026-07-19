// Client-safe shared types (no server-only imports here).

import type { TradeImageKind } from "./tradingview-snapshot";

export type OptionItem = {
  id: string;
  value: string;
  label: string;
  color: string | null;
  is_active: boolean;
  sort_order: number;
};

export type OptionList = {
  id: string;
  key: string;
  label: string;
  category: string | null;
  sort_order: number;
  items: OptionItem[];
};

export type OptionsMap = Record<string, OptionItem[]>;

export type Instrument = {
  id: string;
  symbol: string;
  name: string | null;
  asset_class: string | null;
  point_value: number;
  tick_size: number | null;
  tick_value: number | null;
  currency: string;
  is_active: boolean;
  sort_order: number;
};

export type Account = {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  starting_balance: number;
  default_asset_class: string | null;
  timezone: string;
  is_active: boolean;
  // FTMO / prop-firm challenge mode (per account).
  ftmo_mode: boolean;
  ftmo_daily_loss_enabled: boolean;
  ftmo_daily_loss_pct: number;
  ftmo_max_loss_enabled: boolean;
  ftmo_max_loss_pct: number;
  ftmo_profit_target_enabled: boolean;
  ftmo_profit_target_pct: number;
  ftmo_min_days_enabled: boolean;
  ftmo_min_days: number;
  ftmo_reset_at: string | null;
};

export type PositionStat = {
  position_id: string;
  avg_entry: number | null;
  avg_exit: number | null;
  entry_qty: number | null;
  exit_qty: number | null;
  gross_pl: number | null;
  net_pl: number | null;
  total_fees: number | null;
  total_swap: number | null;
  realized_r: number | null;
  realized_r_net: number | null;
  opened_at: string | null;
  closed_at: string | null;
  duration_seconds: number | null;
  point_value: number | null;
};

export type TradeTvImages = Partial<Record<TradeImageKind, string>>;

export type TradeRow = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  status: string;
  source: string;
  needs_review: boolean;
  created_at: string;
  stats: PositionStat | null;
  tv_images?: TradeTvImages;
} & Record<string, unknown>;
