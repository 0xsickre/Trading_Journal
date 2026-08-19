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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      tj_accounts: {
        Row: {
          breakeven_from: number
          breakeven_to: number
          breakeven_unit: string
          broker: string | null
          created_at: string
          currency: string
          default_asset_class: string | null
          default_commission_per_unit: number
          default_fee_fixed: number
          default_stop_pct: number | null
          default_swap_per_day: number
          default_target_pct: number | null
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
          breakeven_from?: number
          breakeven_to?: number
          breakeven_unit?: string
          broker?: string | null
          created_at?: string
          currency?: string
          default_asset_class?: string | null
          default_commission_per_unit?: number
          default_fee_fixed?: number
          default_stop_pct?: number | null
          default_swap_per_day?: number
          default_target_pct?: number | null
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
          breakeven_from?: number
          breakeven_to?: number
          breakeven_unit?: string
          broker?: string | null
          created_at?: string
          currency?: string
          default_asset_class?: string | null
          default_commission_per_unit?: number
          default_fee_fixed?: number
          default_stop_pct?: number | null
          default_swap_per_day?: number
          default_target_pct?: number | null
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
      tj_cash_events: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          event_type: string
          id: string
          note: string | null
          occurred_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          event_type: string
          id?: string
          note?: string | null
          occurred_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          event_type?: string
          id?: string
          note?: string | null
          occurred_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_cash_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "tj_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_daily_reports: {
        Row: {
          created_at: string
          id: string
          impulse_fear: boolean
          impulse_fear_wrong: boolean
          impulse_fomo: boolean
          impulse_greed: boolean
          impulse_note: string | null
          locked_at: string | null
          macro_note: string | null
          mental_temp: number | null
          no_trade_day: boolean
          report_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          impulse_fear?: boolean
          impulse_fear_wrong?: boolean
          impulse_fomo?: boolean
          impulse_greed?: boolean
          impulse_note?: string | null
          locked_at?: string | null
          macro_note?: string | null
          mental_temp?: number | null
          no_trade_day?: boolean
          report_date: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          impulse_fear?: boolean
          impulse_fear_wrong?: boolean
          impulse_fomo?: boolean
          impulse_greed?: boolean
          impulse_note?: string | null
          locked_at?: string | null
          macro_note?: string | null
          mental_temp?: number | null
          no_trade_day?: boolean
          report_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_dashboard_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
          widgets: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
          widgets: string[]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          widgets?: string[]
        }
        Relationships: []
      }
      tj_executions: {
        Row: {
          created_at: string
          executed_at: string
          fee: number
          id: string
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
          prev_executions: Json | null
          prev_gross_pnl_override: number | null
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
          prev_executions?: Json | null
          prev_gross_pnl_override?: number | null
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
          prev_executions?: Json | null
          prev_gross_pnl_override?: number | null
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
          quote_currency: string
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
          quote_currency?: string
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
          quote_currency?: string
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
      tj_note_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          template_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          template_text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          template_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_note_tags: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_notes: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          folder_id: string | null
          id: string
          pinned: boolean
          position_id: string | null
          report_date: string | null
          tags: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          pinned?: boolean
          position_id?: string | null
          report_date?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          folder_id?: string | null
          id?: string
          pinned?: boolean
          position_id?: string | null
          report_date?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "tj_note_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tj_notes_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_user_prefs: {
        Row: {
          created_at: string
          dashboard_hidden_widgets: string[]
          dashboard_template_id: string | null
          dashboard_widget_order: string[]
          journal_hidden_columns: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dashboard_hidden_widgets?: string[]
          dashboard_template_id?: string | null
          dashboard_widget_order?: string[]
          journal_hidden_columns?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dashboard_hidden_widgets?: string[]
          dashboard_template_id?: string | null
          dashboard_widget_order?: string[]
          journal_hidden_columns?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_user_prefs_dashboard_template_id_fkey"
            columns: ["dashboard_template_id"]
            isOneToOne: false
            referencedRelation: "tj_dashboard_templates"
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
      tj_field_defs: {
        Row: {
          created_at: string
          field_type: string
          group_id: string
          id: string
          is_active: boolean
          key: string
          label: string
          list_key: string | null
          show_when: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          field_type?: string
          group_id?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          list_key?: string | null
          show_when?: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          field_type?: string
          group_id?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          list_key?: string | null
          show_when?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_playbook_rule_links: {
        Row: {
          created_at: string
          id: string
          playbook_id: string
          rule_id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          playbook_id: string
          rule_id: string
          sort_order?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          playbook_id?: string
          rule_id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_playbook_rule_links_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "tj_playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tj_playbook_rule_links_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "tj_playbook_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_playbook_rules: {
        Row: {
          category: string
          created_at: string
          deleted_at: string | null
          id: string
          show_when: string
          sort_order: number
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          show_when?: string
          sort_order?: number
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          show_when?: string
          sort_order?: number
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_playbooks: {
        Row: {
          a_plus_criteria: string | null
          color: string | null
          created_at: string
          default_risk_pct: number | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          a_plus_criteria?: string | null
          color?: string | null
          created_at?: string
          default_risk_pct?: number | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          a_plus_criteria?: string | null
          color?: string | null
          created_at?: string
          default_risk_pct?: number | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tj_position_checkins: {
        Row: {
          created_at: string
          id: string
          note: string | null
          position_id: string
          report_date: string
          thesis_state: string | null
          touched: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          position_id: string
          report_date: string
          thesis_state?: string | null
          touched?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          position_id?: string
          report_date?: string
          thesis_state?: string | null
          touched?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_position_checkins_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_position_stats"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "tj_position_checkins_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_position_rules: {
        Row: {
          created_at: string
          followed: boolean | null
          id: string
          position_id: string
          rule_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          followed?: boolean | null
          id?: string
          position_id: string
          rule_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          followed?: boolean | null
          id?: string
          position_id?: string
          rule_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_position_rules_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "tj_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tj_position_rules_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "tj_playbook_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_positions: {
        Row: {
          account_id: string | null
          conviction: number | null
          created_at: string
          custom: Json
          direction: string | null
          entry_price: number | null
          execution_rating: number | null
          exit_reason: string | null
          id: string
          import_batch_id: string | null
          instrument: string | null
          invalidation: string | null
          max_drawdown_price: number | null
          max_profit_price: number | null
          mistake: string[]
          miss_reason: string | null
          missed_at: string | null
          needs_review: boolean
          planned_rr: string | null
          playbook_id: string | null
          point_value_at_trade: number | null
          position_size: number | null
          psychology_tags: string[]
          quote_currency_at_trade: string | null
          fx_rate_at_trade: number | null
          gross_pnl_override: number | null
          risk_pct: string | null
          scale_out_levels: Json
          scale_out_plan: string | null
          setup_grade: string | null
          source: string
          status: string
          stop_price: number | null
          target_price: number | null
          technical_tags: string[]
          thesis: string | null
          tick_size_at_trade: number | null
          time_stop_days: number | null
          trade_journal_notes: string | null
          trade_no: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          conviction?: number | null
          created_at?: string
          custom?: Json
          direction?: string | null
          entry_price?: number | null
          execution_rating?: number | null
          exit_reason?: string | null
          id?: string
          import_batch_id?: string | null
          instrument?: string | null
          invalidation?: string | null
          max_drawdown_price?: number | null
          max_profit_price?: number | null
          mistake?: string[]
          miss_reason?: string | null
          missed_at?: string | null
          needs_review?: boolean
          planned_rr?: string | null
          playbook_id?: string | null
          point_value_at_trade?: number | null
          position_size?: number | null
          psychology_tags?: string[]
          quote_currency_at_trade?: string | null
          fx_rate_at_trade?: number | null
          gross_pnl_override?: number | null
          risk_pct?: string | null
          scale_out_levels?: Json
          scale_out_plan?: string | null
          setup_grade?: string | null
          source?: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
          technical_tags?: string[]
          thesis?: string | null
          tick_size_at_trade?: number | null
          time_stop_days?: number | null
          trade_journal_notes?: string | null
          trade_no?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string | null
          conviction?: number | null
          created_at?: string
          custom?: Json
          direction?: string | null
          entry_price?: number | null
          execution_rating?: number | null
          exit_reason?: string | null
          id?: string
          import_batch_id?: string | null
          instrument?: string | null
          invalidation?: string | null
          max_drawdown_price?: number | null
          max_profit_price?: number | null
          mistake?: string[]
          miss_reason?: string | null
          missed_at?: string | null
          needs_review?: boolean
          planned_rr?: string | null
          playbook_id?: string | null
          point_value_at_trade?: number | null
          position_size?: number | null
          psychology_tags?: string[]
          quote_currency_at_trade?: string | null
          fx_rate_at_trade?: number | null
          gross_pnl_override?: number | null
          risk_pct?: string | null
          scale_out_levels?: Json
          scale_out_plan?: string | null
          setup_grade?: string | null
          source?: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
          technical_tags?: string[]
          thesis?: string | null
          tick_size_at_trade?: number | null
          time_stop_days?: number | null
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
          {
            foreignKeyName: "tj_positions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "tj_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tj_positions_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "tj_playbooks"
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
      tj_tracker_checkins: {
        Row: {
          auto_evaluated: boolean
          checked: boolean | null
          created_at: string
          id: string
          report_date: string
          rule_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_evaluated?: boolean
          checked?: boolean | null
          created_at?: string
          id?: string
          report_date: string
          rule_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_evaluated?: boolean
          checked?: boolean | null
          created_at?: string
          id?: string
          report_date?: string
          rule_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tj_tracker_checkins_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "tj_tracker_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      tj_weekly_reviews: {
        Row: {
          created_at: string
          id: string
          locked_at: string | null
          next_week_catalysts: string | null
          one_change: string | null
          one_pattern: string | null
          updated_at: string
          user_id: string
          week_grade: string | null
          week_start: string
          went_badly: string | null
          went_well: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          locked_at?: string | null
          next_week_catalysts?: string | null
          one_change?: string | null
          one_pattern?: string | null
          updated_at?: string
          user_id: string
          week_grade?: string | null
          week_start: string
          went_badly?: string | null
          went_well?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          locked_at?: string | null
          next_week_catalysts?: string | null
          one_change?: string | null
          one_pattern?: string | null
          updated_at?: string
          user_id?: string
          week_grade?: string | null
          week_start?: string
          went_badly?: string | null
          went_well?: string | null
        }
        Relationships: []
      }
      tj_tracker_rules: {
        Row: {
          active_days: number[]
          auto_key: string | null
          config: Json
          created_at: string
          deleted_at: string | null
          id: string
          is_mandatory: boolean
          sort_order: number
          stage: string
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_days?: number[]
          auto_key?: string | null
          config?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_mandatory?: boolean
          sort_order?: number
          stage?: string
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_days?: number[]
          auto_key?: string | null
          config?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_mandatory?: boolean
          sort_order?: number
          stage?: string
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          money_overridden: boolean | null
          net_pl: number | null
          opened_at: string | null
          account_currency: string | null
          fx_rate: number | null
          fx_rate_source: string | null
          point_value: number | null
          point_value_source: string | null
          position_id: string | null
          quote_currency: string | null
          realized_r: number | null
          realized_r_net: number | null
          status: string | null
          tick_size: number | null
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
      tj_add_option_item: {
        Args: { p_list_id: string; p_label: string }
        Returns: Database["public"]["Tables"]["tj_option_items"]["Row"]
      }
      tj_add_option_list: {
        Args: { p_key: string; p_label: string; p_category?: string | null }
        Returns: Database["public"]["Tables"]["tj_option_lists"]["Row"]
      }
      tj_lock_day: {
        Args: { p_date: string; p_auto?: Json }
        Returns: undefined
      }
      tj_replace_executions: {
        Args: { p_position_id: string; p_executions: Json }
        Returns: number
      }
      tj_replace_position_rules: {
        Args: { p_position_id: string; p_rules: Json }
        Returns: number
      }
      tj_undo_import_batch: {
        Args: {
          p_batch_id: string
          p_restore?: Json
          p_delete_ids?: string[]
        }
        Returns: undefined
      }
      tj_save_trade: {
        Args: {
          p_id?: string
          p_position?: Json
          p_executions?: Json
          p_rules?: Json
          p_images?: Json
        }
        Returns: string
      }
      tj_delete_account: { Args: { p_account_id: string }; Returns: undefined }
      tj_reset_my_data: { Args: never; Returns: undefined }
      tj_seed_defaults: { Args: { target: string }; Returns: undefined }
      tj_seed_note_folders: { Args: { target: string }; Returns: undefined }
      tj_seed_instruments_defaults: {
        Args: { target: string }
        Returns: undefined
      }
      tj_seed_my_defaults: { Args: never; Returns: undefined }
      tj_seed_playbooks: { Args: { target: string }; Returns: undefined }
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
