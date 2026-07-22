export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      tj_accounts: {
        Row: {
          broker: string | null
          created_at: string
          currency: string
          default_asset_class: string | null
          ftmo_daily_loss_enabled: boolean
          ftmo_daily_loss_pct: number
          ftmo_max_loss_enabled: boolean
          ftmo_max_loss_pct: number
          ftmo_min_days: number
          ftmo_min_days_enabled: boolean
          ftmo_mode: boolean
          ftmo_profit_target_enabled: boolean
          ftmo_profit_target_pct: number
          ftmo_reset_at: string | null
          id: string
          is_active: boolean
          name: string
          starting_balance: number
          timezone: string
          user_id: string
        }
        Insert: {
          broker?: string | null
          created_at?: string
          currency?: string
          default_asset_class?: string | null
          ftmo_daily_loss_enabled?: boolean
          ftmo_daily_loss_pct?: number
          ftmo_max_loss_enabled?: boolean
          ftmo_max_loss_pct?: number
          ftmo_min_days?: number
          ftmo_min_days_enabled?: boolean
          ftmo_mode?: boolean
          ftmo_profit_target_enabled?: boolean
          ftmo_profit_target_pct?: number
          ftmo_reset_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          starting_balance?: number
          timezone?: string
          user_id?: string
        }
        Update: {
          broker?: string | null
          created_at?: string
          currency?: string
          default_asset_class?: string | null
          ftmo_daily_loss_enabled?: boolean
          ftmo_daily_loss_pct?: number
          ftmo_max_loss_enabled?: boolean
          ftmo_max_loss_pct?: number
          ftmo_min_days?: number
          ftmo_min_days_enabled?: boolean
          ftmo_mode?: boolean
          ftmo_profit_target_enabled?: boolean
          ftmo_profit_target_pct?: number
          ftmo_reset_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          starting_balance?: number
          timezone?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_column_mappings: {
        Row: {
          broker_name: string
          created_at: string
          id: string
          mapping: Json
          user_id: string
        }
        Insert: {
          broker_name: string
          created_at?: string
          id?: string
          mapping: Json
          user_id?: string
        }
        Update: {
          broker_name?: string
          created_at?: string
          id?: string
          mapping?: Json
          user_id?: string
        }
        Relationships: []
      }
      tj_daily_reports: {
        Row: {
          celebrate_win: string | null
          created_at: string
          day_grade: string | null
          day_overview: string | null
          easiest_setup: string | null
          friday_flat: boolean | null
          id: string
          impulse_fear: boolean
          impulse_fear_wrong: boolean
          impulse_fomo: boolean
          impulse_greed: boolean
          impulse_note: string | null
          learned_today: string | null
          macro_note: string | null
          mantra_risk: boolean
          mantra_rules: boolean
          mantra_series: boolean
          market_type: string | null
          mental_rehearsal: string | null
          mental_temp: number | null
          micromanage: string | null
          no_trade_day: boolean
          report_date: string
          risk_accepted: boolean
          rule_broken: boolean | null
          rule_broken_note: string | null
          sleep_quality: number | null
          tomorrow_change: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          celebrate_win?: string | null
          created_at?: string
          day_grade?: string | null
          day_overview?: string | null
          easiest_setup?: string | null
          friday_flat?: boolean | null
          id?: string
          impulse_fear?: boolean
          impulse_fear_wrong?: boolean
          impulse_fomo?: boolean
          impulse_greed?: boolean
          impulse_note?: string | null
          learned_today?: string | null
          macro_note?: string | null
          mantra_risk?: boolean
          mantra_rules?: boolean
          mantra_series?: boolean
          market_type?: string | null
          mental_rehearsal?: string | null
          mental_temp?: number | null
          micromanage?: string | null
          no_trade_day?: boolean
          report_date: string
          risk_accepted?: boolean
          rule_broken?: boolean | null
          rule_broken_note?: string | null
          sleep_quality?: number | null
          tomorrow_change?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          celebrate_win?: string | null
          created_at?: string
          day_grade?: string | null
          day_overview?: string | null
          easiest_setup?: string | null
          friday_flat?: boolean | null
          id?: string
          impulse_fear?: boolean
          impulse_fear_wrong?: boolean
          impulse_fomo?: boolean
          impulse_greed?: boolean
          impulse_note?: string | null
          learned_today?: string | null
          macro_note?: string | null
          mantra_risk?: boolean
          mantra_rules?: boolean
          mantra_series?: boolean
          market_type?: string | null
          mental_rehearsal?: string | null
          mental_temp?: number | null
          micromanage?: string | null
          no_trade_day?: boolean
          report_date?: string
          risk_accepted?: boolean
          rule_broken?: boolean | null
          rule_broken_note?: string | null
          sleep_quality?: number | null
          tomorrow_change?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_executions: {
        Row: {
          created_at: string
          executed_at: string
          fee: number
          id: string
          import_row_id: string | null
          position_id: string
          price: number
          qty: number
          side: string
          source: string
          swap_funding: number
          user_id: string
        }
        Insert: {
          created_at?: string
          executed_at: string
          fee?: number
          id?: string
          import_row_id?: string | null
          position_id: string
          price: number
          qty: number
          side: string
          source?: string
          swap_funding?: number
          user_id?: string
        }
        Update: {
          created_at?: string
          executed_at?: string
          fee?: number
          id?: string
          import_row_id?: string | null
          position_id?: string
          price?: number
          qty?: number
          side?: string
          source?: string
          swap_funding?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_executions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_position_stats"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "tj_executions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_focus_goals: {
        Row: {
          created_at: string
          ended_at: string | null
          goal_text: string
          id: string
          is_active: boolean
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          goal_text: string
          id?: string
          is_active?: boolean
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          goal_text?: string
          id?: string
          is_active?: boolean
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_import_batches: {
        Row: {
          account_id: string | null
          broker_preset: string | null
          created_at: string
          filename: string | null
          id: string
          summary: Json | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          broker_preset?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          summary?: Json | null
          user_id?: string
        }
        Update: {
          account_id?: string | null
          broker_preset?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          summary?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tj_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_import_rows: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          match_status: string
          matched_position_id: string | null
          parsed: Json | null
          raw: Json | null
          user_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          match_status?: string
          matched_position_id?: string | null
          parsed?: Json | null
          raw?: Json | null
          user_id?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          match_status?: string
          matched_position_id?: string | null
          parsed?: Json | null
          raw?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tj_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tj_import_rows_matched_position_id_fkey"
            columns: ["matched_position_id"]
            isOneToOne: false
            referencedRelation: "tj_position_stats"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "tj_import_rows_matched_position_id_fkey"
            columns: ["matched_position_id"]
            isOneToOne: false
            referencedRelation: "tj_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_instruments: {
        Row: {
          asset_class: string | null
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string | null
          point_value: number
          sort_order: number
          symbol: string
          tick_size: number | null
          tick_value: number | null
          user_id: string
        }
        Insert: {
          asset_class?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string | null
          point_value?: number
          sort_order?: number
          symbol: string
          tick_size?: number | null
          tick_value?: number | null
          user_id?: string
        }
        Update: {
          asset_class?: string | null
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string | null
          point_value?: number
          sort_order?: number
          symbol?: string
          tick_size?: number | null
          tick_value?: number | null
          user_id?: string
        }
        Relationships: []
      }
      tj_option_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          label: string
          list_id: string
          sort_order: number
          user_id: string
          value: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          list_id: string
          sort_order?: number
          user_id?: string
          value: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          list_id?: string
          sort_order?: number
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_option_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "tj_option_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_option_lists: {
        Row: {
          category: string | null
          created_at: string
          id: string
          key: string
          label: string
          sort_order: number
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          key: string
          label: string
          sort_order?: number
          user_id?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          key?: string
          label?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      tj_positions: {
        Row: {
          account_id: string | null
          cot_filter: string | null
          created_at: string
          direction: string | null
          entry_price: number | null
          entry_tf: string | null
          exit_reason: string | null
          htf_bias: string | null
          ict_entry_model: string | null
          id: string
          import_batch_id: string | null
          instrument: string | null
          macro_align: string | null
          max_drawdown_price: number | null
          max_profit_price: number | null
          mistake: string | null
          miss_reason: string | null
          missed_at: string | null
          needs_review: boolean
          planned_rr: string | null
          position_size: number | null
          psychology_tags: string[]
          result: string | null
          risk_pct: string | null
          session_killzone: string | null
          setup_grade: string | null
          source: string
          status: string
          stop_price: number | null
          target_price: number | null
          technical_tags: string[]
          trade_journal_notes: string | null
          trade_no: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          cot_filter?: string | null
          created_at?: string
          direction?: string | null
          entry_price?: number | null
          entry_tf?: string | null
          exit_reason?: string | null
          htf_bias?: string | null
          ict_entry_model?: string | null
          id?: string
          import_batch_id?: string | null
          instrument?: string | null
          macro_align?: string | null
          max_drawdown_price?: number | null
          max_profit_price?: number | null
          mistake?: string | null
          miss_reason?: string | null
          missed_at?: string | null
          needs_review?: boolean
          planned_rr?: string | null
          position_size?: number | null
          psychology_tags?: string[]
          result?: string | null
          risk_pct?: string | null
          session_killzone?: string | null
          setup_grade?: string | null
          source?: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
          technical_tags?: string[]
          trade_journal_notes?: string | null
          trade_no?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string | null
          cot_filter?: string | null
          created_at?: string
          direction?: string | null
          entry_price?: number | null
          entry_tf?: string | null
          exit_reason?: string | null
          htf_bias?: string | null
          ict_entry_model?: string | null
          id?: string
          import_batch_id?: string | null
          instrument?: string | null
          macro_align?: string | null
          max_drawdown_price?: number | null
          max_profit_price?: number | null
          mistake?: string | null
          miss_reason?: string | null
          missed_at?: string | null
          needs_review?: boolean
          planned_rr?: string | null
          position_size?: number | null
          psychology_tags?: string[]
          result?: string | null
          risk_pct?: string | null
          session_killzone?: string | null
          setup_grade?: string | null
          source?: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
          technical_tags?: string[]
          trade_journal_notes?: string | null
          trade_no?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_positions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tj_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_trade_images: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          image_url: string
          kind: string
          position_id: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          kind?: string
          position_id: string
          user_id?: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          kind?: string
          position_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_trade_images_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_position_stats"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "tj_trade_images_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_positions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      tj_position_stats: {
        Row: {
          account_id: string | null
          avg_entry: number | null
          avg_exit: number | null
          closed_at: string | null
          dir_mult: number | null
          direction: string | null
          duration_seconds: number | null
          entry_qty: number | null
          exit_qty: number | null
          gross_pl: number | null
          gross_points: number | null
          instrument: string | null
          net_pl: number | null
          opened_at: string | null
          point_value: number | null
          position_id: string | null
          realized_r: number | null
          realized_r_net: number | null
          result: string | null
          status: string | null
          total_fees: number | null
          total_swap: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tj_positions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tj_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      tj_seed_defaults: { Args: { target: string }; Returns: undefined }
      tj_seed_instruments_defaults: {
        Args: { target: string }
        Returns: undefined
      }
      tj_seed_my_defaults: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
