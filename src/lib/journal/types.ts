// Client-safe shared types (no server-only imports here).

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
  opened_at: string | null;
  closed_at: string | null;
  duration_seconds: number | null;
  point_value: number | null;
};

export type TradeRow = {
  id: string;
  account_id: string | null;
  trade_no: number | null;
  status: string;
  source: string;
  needs_review: boolean;
  created_at: string;
  stats: PositionStat | null;
} & Record<string, unknown>;

export type BiasValue = "bullish" | "bearish" | "neutral";
export type BiasStatus = "open" | "win" | "loss";

export type BiasAnalysis = {
  id: string;
  instrument: string | null;
  bias: BiasValue;
  start_date: string;
  period_weeks: number;
  end_date: string | null;
  status: BiasStatus;
  conviction: string | null;
  notes: string | null;
  chart_url: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // COT factors
  cot_score: string | null;
  cot_verdict: string | null;
  cot_idx_3y: string | null;
  cot_flow: string | null;
  cot_confidence: string | null;
  seasonality: string | null;
  cot_timing: string | null;
  // Macro factors
  rates_regime: string | null;
  yield_curve: string | null;
  growth_bias: string | null;
  dxy_1m: string | null;
  energy_stress: string | null;
  fx_policy_spread: string | null;
  // Vol / risk factors
  vix_level: string | null;
  move_level: string | null;
  shield_active: string | null;
  dxy_trend: string | null;
};
