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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          event_id: string | null
          id: string
          meta: Json
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          event_id?: string | null
          id?: string
          meta?: Json
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string | null
          id?: string
          meta?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_status: {
        Row: {
          agent_id: string
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_status_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_status_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_status_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agreement_documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_html: string | null
          created_at: string
          id: string
          is_active: boolean
          status: Database["public"]["Enums"]["agreement_status"]
          updated_at: string
          version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_html?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          status?: Database["public"]["Enums"]["agreement_status"]
          updated_at?: string
          version: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_html?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          status?: Database["public"]["Enums"]["agreement_status"]
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          agr_charge_window_days: string | null
          agr_hold_release_days: string | null
          agr_liability_cap: string | null
          agr_offer_validity_days: string | null
          agr_record_retention_months: string | null
          agr_retention_days: string | null
          agr_service_activation_window: string | null
          base_overage_pricing_enabled: boolean
          billing_exposure_gate: boolean
          call_consent_required: boolean
          campaign_holds_enabled: boolean
          cancellation_fee_cap: number
          cancellation_fee_percent: number
          cancellation_refund_days: number
          close_charge_enabled: boolean
          company_contact_email: string | null
          company_contact_phone: string | null
          company_legal_address: string | null
          company_legal_id: string | null
          company_legal_name: string | null
          console_call_me_now_enabled: boolean
          console_consult_conference_enabled: boolean
          console_dtmf_handoff_enabled: boolean
          console_manual_dial_enabled: boolean
          console_softphone_enabled: boolean
          console_wake_enabled: boolean
          console_widget_enabled: boolean
          cookie_consent_analytics_enabled: boolean
          cookie_consent_enabled: boolean
          cookie_consent_marketing_enabled: boolean
          cookie_consent_revision_bump: number
          elevenlabs_api_key: string | null
          email_enabled: boolean
          exchange_connection_mode: string
          extra_sms_sender: string | null
          extra_sms_token: string | null
          extreme_threshold_contacts: number
          handoff_enabled: boolean
          id: boolean
          inbound_ai_answer_enabled: boolean
          inbound_calls_enabled: boolean
          inquiry_followup_enabled: boolean
          monitor_enabled: boolean
          outreach_enabled: boolean
          payments_enabled: boolean
          privacy_url: string | null
          reasonable_coverage_contacts: number
          slack_alert_campaign_billing: boolean
          slack_alert_channel_id: string | null
          slack_alert_customer_inquiry: boolean
          slack_alert_errors: boolean
          slack_alert_security: boolean
          slack_alert_send_health: boolean
          slack_alerts_enabled: boolean
          slack_bot_token: string | null
          slack_mention_min_level: string
          slack_mention_user_id: string | null
          sms_enabled: boolean
          smtp_from: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_secure: boolean
          smtp_user: string | null
          sumit_api_key: string | null
          sumit_api_public_key: string | null
          sumit_company_id: string | null
          terms_url: string | null
          updated_at: string
          voximplant_account_callback_prev: Json | null
          voximplant_account_callback_salt: string | null
          voximplant_account_callback_state: string
          voximplant_account_callback_token_hash: string | null
          voximplant_account_callback_wired_at: string | null
          voximplant_application_id: string | null
          voximplant_balance_callback_at: string | null
          voximplant_call_me_now_rule_id: string | null
          voximplant_callback_secret: string | null
          voximplant_caller_id: string | null
          voximplant_live_calls: boolean
          voximplant_low_balance_threshold: number
          voximplant_max_calls_per_campaign_hour: number
          voximplant_max_concurrent_calls: number
          voximplant_meeting_confirm_enabled: boolean
          voximplant_meeting_confirm_rule_id: string | null
          voximplant_min_call_reserve: number
          voximplant_rule_id: string | null
          voximplant_sales_call_rule_id: string | null
          voximplant_sales_calls_enabled: boolean
          voximplant_service_account_json: string | null
          warranty_text: string | null
          whatsapp_access_token: string | null
          whatsapp_app_secret: string | null
          whatsapp_phone_number_id: string | null
          whatsapp_send_policy: Json | null
          whatsapp_verify_token: string | null
          whatsapp_waba_id: string | null
        }
        Insert: {
          agr_charge_window_days?: string | null
          agr_hold_release_days?: string | null
          agr_liability_cap?: string | null
          agr_offer_validity_days?: string | null
          agr_record_retention_months?: string | null
          agr_retention_days?: string | null
          agr_service_activation_window?: string | null
          base_overage_pricing_enabled?: boolean
          billing_exposure_gate?: boolean
          call_consent_required?: boolean
          campaign_holds_enabled?: boolean
          cancellation_fee_cap?: number
          cancellation_fee_percent?: number
          cancellation_refund_days?: number
          close_charge_enabled?: boolean
          company_contact_email?: string | null
          company_contact_phone?: string | null
          company_legal_address?: string | null
          company_legal_id?: string | null
          company_legal_name?: string | null
          console_call_me_now_enabled?: boolean
          console_consult_conference_enabled?: boolean
          console_dtmf_handoff_enabled?: boolean
          console_manual_dial_enabled?: boolean
          console_softphone_enabled?: boolean
          console_wake_enabled?: boolean
          console_widget_enabled?: boolean
          cookie_consent_analytics_enabled?: boolean
          cookie_consent_enabled?: boolean
          cookie_consent_marketing_enabled?: boolean
          cookie_consent_revision_bump?: number
          elevenlabs_api_key?: string | null
          email_enabled?: boolean
          exchange_connection_mode?: string
          extra_sms_sender?: string | null
          extra_sms_token?: string | null
          extreme_threshold_contacts?: number
          handoff_enabled?: boolean
          id?: boolean
          inbound_ai_answer_enabled?: boolean
          inbound_calls_enabled?: boolean
          inquiry_followup_enabled?: boolean
          monitor_enabled?: boolean
          outreach_enabled?: boolean
          payments_enabled?: boolean
          privacy_url?: string | null
          reasonable_coverage_contacts?: number
          slack_alert_campaign_billing?: boolean
          slack_alert_channel_id?: string | null
          slack_alert_customer_inquiry?: boolean
          slack_alert_errors?: boolean
          slack_alert_security?: boolean
          slack_alert_send_health?: boolean
          slack_alerts_enabled?: boolean
          slack_bot_token?: string | null
          slack_mention_min_level?: string
          slack_mention_user_id?: string | null
          sms_enabled?: boolean
          smtp_from?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean
          smtp_user?: string | null
          sumit_api_key?: string | null
          sumit_api_public_key?: string | null
          sumit_company_id?: string | null
          terms_url?: string | null
          updated_at?: string
          voximplant_account_callback_prev?: Json | null
          voximplant_account_callback_salt?: string | null
          voximplant_account_callback_state?: string
          voximplant_account_callback_token_hash?: string | null
          voximplant_account_callback_wired_at?: string | null
          voximplant_application_id?: string | null
          voximplant_balance_callback_at?: string | null
          voximplant_call_me_now_rule_id?: string | null
          voximplant_callback_secret?: string | null
          voximplant_caller_id?: string | null
          voximplant_live_calls?: boolean
          voximplant_low_balance_threshold?: number
          voximplant_max_calls_per_campaign_hour?: number
          voximplant_max_concurrent_calls?: number
          voximplant_meeting_confirm_enabled?: boolean
          voximplant_meeting_confirm_rule_id?: string | null
          voximplant_min_call_reserve?: number
          voximplant_rule_id?: string | null
          voximplant_sales_call_rule_id?: string | null
          voximplant_sales_calls_enabled?: boolean
          voximplant_service_account_json?: string | null
          warranty_text?: string | null
          whatsapp_access_token?: string | null
          whatsapp_app_secret?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_send_policy?: Json | null
          whatsapp_verify_token?: string | null
          whatsapp_waba_id?: string | null
        }
        Update: {
          agr_charge_window_days?: string | null
          agr_hold_release_days?: string | null
          agr_liability_cap?: string | null
          agr_offer_validity_days?: string | null
          agr_record_retention_months?: string | null
          agr_retention_days?: string | null
          agr_service_activation_window?: string | null
          base_overage_pricing_enabled?: boolean
          billing_exposure_gate?: boolean
          call_consent_required?: boolean
          campaign_holds_enabled?: boolean
          cancellation_fee_cap?: number
          cancellation_fee_percent?: number
          cancellation_refund_days?: number
          close_charge_enabled?: boolean
          company_contact_email?: string | null
          company_contact_phone?: string | null
          company_legal_address?: string | null
          company_legal_id?: string | null
          company_legal_name?: string | null
          console_call_me_now_enabled?: boolean
          console_consult_conference_enabled?: boolean
          console_dtmf_handoff_enabled?: boolean
          console_manual_dial_enabled?: boolean
          console_softphone_enabled?: boolean
          console_wake_enabled?: boolean
          console_widget_enabled?: boolean
          cookie_consent_analytics_enabled?: boolean
          cookie_consent_enabled?: boolean
          cookie_consent_marketing_enabled?: boolean
          cookie_consent_revision_bump?: number
          elevenlabs_api_key?: string | null
          email_enabled?: boolean
          exchange_connection_mode?: string
          extra_sms_sender?: string | null
          extra_sms_token?: string | null
          extreme_threshold_contacts?: number
          handoff_enabled?: boolean
          id?: boolean
          inbound_ai_answer_enabled?: boolean
          inbound_calls_enabled?: boolean
          inquiry_followup_enabled?: boolean
          monitor_enabled?: boolean
          outreach_enabled?: boolean
          payments_enabled?: boolean
          privacy_url?: string | null
          reasonable_coverage_contacts?: number
          slack_alert_campaign_billing?: boolean
          slack_alert_channel_id?: string | null
          slack_alert_customer_inquiry?: boolean
          slack_alert_errors?: boolean
          slack_alert_security?: boolean
          slack_alert_send_health?: boolean
          slack_alerts_enabled?: boolean
          slack_bot_token?: string | null
          slack_mention_min_level?: string
          slack_mention_user_id?: string | null
          sms_enabled?: boolean
          smtp_from?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean
          smtp_user?: string | null
          sumit_api_key?: string | null
          sumit_api_public_key?: string | null
          sumit_company_id?: string | null
          terms_url?: string | null
          updated_at?: string
          voximplant_account_callback_prev?: Json | null
          voximplant_account_callback_salt?: string | null
          voximplant_account_callback_state?: string
          voximplant_account_callback_token_hash?: string | null
          voximplant_account_callback_wired_at?: string | null
          voximplant_application_id?: string | null
          voximplant_balance_callback_at?: string | null
          voximplant_call_me_now_rule_id?: string | null
          voximplant_callback_secret?: string | null
          voximplant_caller_id?: string | null
          voximplant_live_calls?: boolean
          voximplant_low_balance_threshold?: number
          voximplant_max_calls_per_campaign_hour?: number
          voximplant_max_concurrent_calls?: number
          voximplant_meeting_confirm_enabled?: boolean
          voximplant_meeting_confirm_rule_id?: string | null
          voximplant_min_call_reserve?: number
          voximplant_rule_id?: string | null
          voximplant_sales_call_rule_id?: string | null
          voximplant_sales_calls_enabled?: boolean
          voximplant_service_account_json?: string | null
          warranty_text?: string | null
          whatsapp_access_token?: string | null
          whatsapp_app_secret?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_send_policy?: Json | null
          whatsapp_verify_token?: string | null
          whatsapp_waba_id?: string | null
        }
        Relationships: []
      }
      billed_results: {
        Row: {
          attempt_id: string | null
          campaign_id: string
          channel: Database["public"]["Enums"]["campaign_channel"]
          contact_id: string
          control_status: string
          created_at: string
          event_id: string
          evidence_source: string
          id: string
          locked_price: number
          manual_adjustment: Json | null
          provider_ref: string | null
          reached_at: string
        }
        Insert: {
          attempt_id?: string | null
          campaign_id: string
          channel: Database["public"]["Enums"]["campaign_channel"]
          contact_id: string
          control_status?: string
          created_at?: string
          event_id: string
          evidence_source: string
          id?: string
          locked_price: number
          manual_adjustment?: Json | null
          provider_ref?: string | null
          reached_at?: string
        }
        Update: {
          attempt_id?: string | null
          campaign_id?: string
          channel?: Database["public"]["Enums"]["campaign_channel"]
          contact_id?: string
          control_status?: string
          created_at?: string
          event_id?: string
          evidence_source?: string
          id?: string
          locked_price?: number
          manual_adjustment?: Json | null
          provider_ref?: string | null
          reached_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billed_results_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billed_results_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billed_results_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billed_results_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "billed_results_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_credits: {
        Row: {
          amount: number
          campaign_id: string | null
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          reason: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          reason: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          reason?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_credits_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credits_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_credits_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "billing_credits_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      call_analysis: {
        Row: {
          agent_id: string | null
          agent_turns: number | null
          analysis_at: string | null
          call_attempt_id: string | null
          call_duration_secs: number | null
          call_successful: string | null
          conversation_id: string
          cost_credits: number | null
          cost_fiat: number | null
          el_call_score: number | null
          el_data: Json | null
          el_eval: Json | null
          event_id: string | null
          frustration_score: number | null
          id: string
          linked_at: string | null
          overall_score: number | null
          provider: string
          received_at: string
          rsvp_persisted: boolean | null
          sentiment_label: string | null
          status: string | null
          summary_title: string | null
          termination_reason: string | null
          transcript_summary: string | null
          user_turns: number | null
          voicemail_detected: boolean | null
        }
        Insert: {
          agent_id?: string | null
          agent_turns?: number | null
          analysis_at?: string | null
          call_attempt_id?: string | null
          call_duration_secs?: number | null
          call_successful?: string | null
          conversation_id: string
          cost_credits?: number | null
          cost_fiat?: number | null
          el_call_score?: number | null
          el_data?: Json | null
          el_eval?: Json | null
          event_id?: string | null
          frustration_score?: number | null
          id?: string
          linked_at?: string | null
          overall_score?: number | null
          provider?: string
          received_at?: string
          rsvp_persisted?: boolean | null
          sentiment_label?: string | null
          status?: string | null
          summary_title?: string | null
          termination_reason?: string | null
          transcript_summary?: string | null
          user_turns?: number | null
          voicemail_detected?: boolean | null
        }
        Update: {
          agent_id?: string | null
          agent_turns?: number | null
          analysis_at?: string | null
          call_attempt_id?: string | null
          call_duration_secs?: number | null
          call_successful?: string | null
          conversation_id?: string
          cost_credits?: number | null
          cost_fiat?: number | null
          el_call_score?: number | null
          el_data?: Json | null
          el_eval?: Json | null
          event_id?: string | null
          frustration_score?: number | null
          id?: string
          linked_at?: string | null
          overall_score?: number | null
          provider?: string
          received_at?: string
          rsvp_persisted?: boolean | null
          sentiment_label?: string | null
          status?: string | null
          summary_title?: string | null
          termination_reason?: string | null
          transcript_summary?: string | null
          user_turns?: number | null
          voicemail_detected?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "call_analysis_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_analysis_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_analysis_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      call_attempts: {
        Row: {
          access_token: string
          billed_outcome: string | null
          call_duration_sec: number | null
          callback_count: number
          callback_dispatched_at: string | null
          callback_iso: string | null
          callback_requested_at: string | null
          callback_when_text: string | null
          campaign_id: string
          contact_id: string
          created_at: string
          ctx_delivered_at: string | null
          ctx_read_count: number
          dispatch_id: string | null
          el_conversation_id: string | null
          el_correlation_nonce: string | null
          event_id: string
          finish_reason: string | null
          guest_id: string | null
          id: string
          last_callback_at: string | null
          media_session_access_secure_url: string | null
          media_session_access_url: string | null
          recording_started_at: string | null
          recording_url: string | null
          rsvp_digit: string | null
          rsvp_method: string | null
          status: string
          token_expires_at: string
          touchpoint_index: number
          transcript: Json | null
          updated_at: string
          vox_call_session_history_id: string | null
        }
        Insert: {
          access_token: string
          billed_outcome?: string | null
          call_duration_sec?: number | null
          callback_count?: number
          callback_dispatched_at?: string | null
          callback_iso?: string | null
          callback_requested_at?: string | null
          callback_when_text?: string | null
          campaign_id: string
          contact_id: string
          created_at?: string
          ctx_delivered_at?: string | null
          ctx_read_count?: number
          dispatch_id?: string | null
          el_conversation_id?: string | null
          el_correlation_nonce?: string | null
          event_id: string
          finish_reason?: string | null
          guest_id?: string | null
          id?: string
          last_callback_at?: string | null
          media_session_access_secure_url?: string | null
          media_session_access_url?: string | null
          recording_started_at?: string | null
          recording_url?: string | null
          rsvp_digit?: string | null
          rsvp_method?: string | null
          status?: string
          token_expires_at: string
          touchpoint_index: number
          transcript?: Json | null
          updated_at?: string
          vox_call_session_history_id?: string | null
        }
        Update: {
          access_token?: string
          billed_outcome?: string | null
          call_duration_sec?: number | null
          callback_count?: number
          callback_dispatched_at?: string | null
          callback_iso?: string | null
          callback_requested_at?: string | null
          callback_when_text?: string | null
          campaign_id?: string
          contact_id?: string
          created_at?: string
          ctx_delivered_at?: string | null
          ctx_read_count?: number
          dispatch_id?: string | null
          el_conversation_id?: string | null
          el_correlation_nonce?: string | null
          event_id?: string
          finish_reason?: string | null
          guest_id?: string | null
          id?: string
          last_callback_at?: string | null
          media_session_access_secure_url?: string | null
          media_session_access_url?: string | null
          recording_started_at?: string | null
          recording_url?: string | null
          rsvp_digit?: string | null
          rsvp_method?: string | null
          status?: string
          token_expires_at?: string
          touchpoint_index?: number
          transcript?: Json | null
          updated_at?: string
          vox_call_session_history_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "console_event_guests"
            referencedColumns: ["guest_id"]
          },
          {
            foreignKeyName: "call_attempts_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      call_dispatch_status: {
        Row: {
          call_attempt_id: string | null
          contact_id: string
          created_at: string
          dispatch_id: string
          event_id: string
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          call_attempt_id?: string | null
          contact_id: string
          created_at?: string
          dispatch_id: string
          event_id: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          call_attempt_id?: string | null
          contact_id?: string
          created_at?: string
          dispatch_id?: string
          event_id?: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_dispatch_status_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_dispatch_status_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_dispatch_status_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_dispatch_status_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      call_dnc_list: {
        Row: {
          added_by: string | null
          created_at: string
          normalized_phone: string
          reason: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          normalized_phone: string
          reason?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          normalized_phone?: string
          reason?: string | null
        }
        Relationships: []
      }
      callback_request_attempts: {
        Row: {
          access_token: string
          call_duration_sec: number | null
          callback_request_id: string
          confirmation_call_at: string | null
          confirmation_call_status: string
          created_at: string
          dispatch_status: string
          el_conversation_id: string | null
          finish_reason: string | null
          id: string
          issued_via: string
          scheduled_at_snapshot: string
          token_expires_at: string
          updated_at: string
          vox_call_session_history_id: string | null
          call_analysis: {
            agent_id: string | null
            agent_turns: number | null
            analysis_at: string | null
            call_attempt_id: string | null
            call_duration_secs: number | null
            call_successful: string | null
            conversation_id: string
            cost_credits: number | null
            cost_fiat: number | null
            el_call_score: number | null
            el_data: Json | null
            el_eval: Json | null
            event_id: string | null
            frustration_score: number | null
            id: string
            linked_at: string | null
            overall_score: number | null
            provider: string
            received_at: string
            rsvp_persisted: boolean | null
            sentiment_label: string | null
            status: string | null
            summary_title: string | null
            termination_reason: string | null
            transcript_summary: string | null
            user_turns: number | null
            voicemail_detected: boolean | null
          } | null
        }
        Insert: {
          access_token: string
          call_duration_sec?: number | null
          callback_request_id: string
          confirmation_call_at?: string | null
          confirmation_call_status?: string
          created_at?: string
          dispatch_status?: string
          el_conversation_id?: string | null
          finish_reason?: string | null
          id?: string
          issued_via: string
          scheduled_at_snapshot: string
          token_expires_at: string
          updated_at?: string
          vox_call_session_history_id?: string | null
        }
        Update: {
          access_token?: string
          call_duration_sec?: number | null
          callback_request_id?: string
          confirmation_call_at?: string | null
          confirmation_call_status?: string
          created_at?: string
          dispatch_status?: string
          el_conversation_id?: string | null
          finish_reason?: string | null
          id?: string
          issued_via?: string
          scheduled_at_snapshot?: string
          token_expires_at?: string
          updated_at?: string
          vox_call_session_history_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "callback_request_attempts_callback_request_id_fkey"
            columns: ["callback_request_id"]
            isOneToOne: false
            referencedRelation: "callback_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      callback_requests: {
        Row: {
          attempt_count: number
          calendar_item_id: string | null
          call_outcome: string
          consecutive_no_answer_count: number
          created_at: string
          exchange_connection_id: string | null
          excluded_dates: string[] | null
          full_name: string
          id: string
          no_contact_sms_claimed_at: string | null
          no_contact_sms_error: string | null
          no_contact_sms_provider_id: string | null
          no_contact_sms_sent_at: string | null
          not_after_min: number | null
          not_before_min: number | null
          note: string | null
          phone: string
          requested_at: string | null
          requested_rank: string | null
          scheduled_at: string | null
          scheduling_failure_reason: string | null
          status: string
          topic: string | null
          triage: Json | null
          triage_attempt_count: number
          triage_claimed_at: string | null
          triage_last_error: string | null
          triage_status: string
          triaged_at: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          calendar_item_id?: string | null
          call_outcome?: string
          consecutive_no_answer_count?: number
          created_at?: string
          exchange_connection_id?: string | null
          excluded_dates?: string[] | null
          full_name: string
          id?: string
          no_contact_sms_claimed_at?: string | null
          no_contact_sms_error?: string | null
          no_contact_sms_provider_id?: string | null
          no_contact_sms_sent_at?: string | null
          not_after_min?: number | null
          not_before_min?: number | null
          note?: string | null
          phone: string
          requested_at?: string | null
          requested_rank?: string | null
          scheduled_at?: string | null
          scheduling_failure_reason?: string | null
          status?: string
          topic?: string | null
          triage?: Json | null
          triage_attempt_count?: number
          triage_claimed_at?: string | null
          triage_last_error?: string | null
          triage_status?: string
          triaged_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          calendar_item_id?: string | null
          call_outcome?: string
          consecutive_no_answer_count?: number
          created_at?: string
          exchange_connection_id?: string | null
          excluded_dates?: string[] | null
          full_name?: string
          id?: string
          no_contact_sms_claimed_at?: string | null
          no_contact_sms_error?: string | null
          no_contact_sms_provider_id?: string | null
          no_contact_sms_sent_at?: string | null
          not_after_min?: number | null
          not_before_min?: number | null
          note?: string | null
          phone?: string
          requested_at?: string | null
          requested_rank?: string | null
          scheduled_at?: string | null
          scheduling_failure_reason?: string | null
          status?: string
          topic?: string | null
          triage?: Json | null
          triage_attempt_count?: number
          triage_claimed_at?: string | null
          triage_last_error?: string | null
          triage_status?: string
          triaged_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "callback_requests_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callback_requests_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections_status"
            referencedColumns: ["id"]
          },
        ]
      }
      callback_schedule_policies: {
        Row: {
          attempt_window_days: number
          daily_cap: number
          dial_fri_end_min: number | null
          dial_fri_start_min: number | null
          dial_mon_end_min: number | null
          dial_mon_start_min: number | null
          dial_sat_end_min: number | null
          dial_sat_start_min: number | null
          dial_sun_end_min: number | null
          dial_sun_start_min: number | null
          dial_thu_end_min: number | null
          dial_thu_start_min: number | null
          dial_tue_end_min: number | null
          dial_tue_start_min: number | null
          dial_wed_end_min: number | null
          dial_wed_start_min: number | null
          duration_minutes: number
          fri_end_min: number | null
          fri_start_min: number | null
          horizon_days: number
          id: boolean
          max_attempts: number
          min_notice_minutes: number
          mon_end_min: number | null
          mon_start_min: number | null
          motzash_resume_minutes: number
          sat_end_min: number | null
          sat_start_min: number | null
          sun_end_min: number | null
          sun_start_min: number | null
          thu_end_min: number | null
          thu_start_min: number | null
          tue_end_min: number | null
          tue_start_min: number | null
          updated_at: string
          wed_end_min: number | null
          wed_start_min: number | null
        }
        Insert: {
          attempt_window_days?: number
          daily_cap?: number
          dial_fri_end_min?: number | null
          dial_fri_start_min?: number | null
          dial_mon_end_min?: number | null
          dial_mon_start_min?: number | null
          dial_sat_end_min?: number | null
          dial_sat_start_min?: number | null
          dial_sun_end_min?: number | null
          dial_sun_start_min?: number | null
          dial_thu_end_min?: number | null
          dial_thu_start_min?: number | null
          dial_tue_end_min?: number | null
          dial_tue_start_min?: number | null
          dial_wed_end_min?: number | null
          dial_wed_start_min?: number | null
          duration_minutes?: number
          fri_end_min?: number | null
          fri_start_min?: number | null
          horizon_days?: number
          id?: boolean
          max_attempts?: number
          min_notice_minutes?: number
          mon_end_min?: number | null
          mon_start_min?: number | null
          motzash_resume_minutes?: number
          sat_end_min?: number | null
          sat_start_min?: number | null
          sun_end_min?: number | null
          sun_start_min?: number | null
          thu_end_min?: number | null
          thu_start_min?: number | null
          tue_end_min?: number | null
          tue_start_min?: number | null
          updated_at?: string
          wed_end_min?: number | null
          wed_start_min?: number | null
        }
        Update: {
          attempt_window_days?: number
          daily_cap?: number
          dial_fri_end_min?: number | null
          dial_fri_start_min?: number | null
          dial_mon_end_min?: number | null
          dial_mon_start_min?: number | null
          dial_sat_end_min?: number | null
          dial_sat_start_min?: number | null
          dial_sun_end_min?: number | null
          dial_sun_start_min?: number | null
          dial_thu_end_min?: number | null
          dial_thu_start_min?: number | null
          dial_tue_end_min?: number | null
          dial_tue_start_min?: number | null
          dial_wed_end_min?: number | null
          dial_wed_start_min?: number | null
          duration_minutes?: number
          fri_end_min?: number | null
          fri_start_min?: number | null
          horizon_days?: number
          id?: boolean
          max_attempts?: number
          min_notice_minutes?: number
          mon_end_min?: number | null
          mon_start_min?: number | null
          motzash_resume_minutes?: number
          sat_end_min?: number | null
          sat_start_min?: number | null
          sun_end_min?: number | null
          sun_start_min?: number | null
          thu_end_min?: number | null
          thu_start_min?: number | null
          tue_end_min?: number | null
          tue_start_min?: number | null
          updated_at?: string
          wed_end_min?: number | null
          wed_start_min?: number | null
        }
        Relationships: []
      }
      campaign_authorized_contacts: {
        Row: {
          campaign_id: string
          contact_id: string
          created_at: string
          event_id: string
          id: string
        }
        Insert: {
          campaign_id: string
          contact_id: string
          created_at?: string
          event_id: string
          id?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          created_at?: string
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_authorized_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_authorized_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_authorized_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_authorized_contacts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "campaign_authorized_contacts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_authorized_set_audit: {
        Row: {
          action: string | null
          actor: string | null
          at: string
          campaign_id: string
          contact_id: string | null
          event_id: string
          id: string
          prev_contact_id: string | null
          reason: string | null
          resulting_size: number | null
        }
        Insert: {
          action?: string | null
          actor?: string | null
          at?: string
          campaign_id: string
          contact_id?: string | null
          event_id: string
          id?: string
          prev_contact_id?: string | null
          reason?: string | null
          resulting_size?: number | null
        }
        Update: {
          action?: string | null
          actor?: string | null
          at?: string
          campaign_id?: string
          contact_id?: string | null
          event_id?: string
          id?: string
          prev_contact_id?: string | null
          reason?: string | null
          resulting_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_authorized_set_audit_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_authorized_set_audit_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_authorized_set_audit_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "campaign_authorized_set_audit_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          allowed_channels: Database["public"]["Enums"]["campaign_channel"][]
          approved_at: string | null
          approved_by: string | null
          auth_amount: number | null
          auth_expires_at: string | null
          auth_external_ref: string | null
          auth_number: string | null
          authorized_at: string | null
          base_price: number | null
          billing_route: Database["public"]["Enums"]["billing_route"] | null
          capture_status: string | null
          card_citizen_id: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_token_ref: string | null
          charge_auth_number: string | null
          charge_document_number: number | null
          charge_document_url: string | null
          charge_payment_id: number | null
          charge_status: string | null
          charged_at: string | null
          close_at: string | null
          created_at: string
          credit_applied: number
          enabled: boolean
          event_id: string
          final_charge_amount: number | null
          final_invoice_document_id: number | null
          hold_order_document_id: number | null
          hold_order_document_number: number | null
          hold_order_document_url: string | null
          id: string
          included_reached: number | null
          max_charge_ceiling: number | null
          max_contacts: number
          outreach_schedule: Json | null
          price_per_reached: number | null
          release_status: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          steps: Json
          sumit_charge_document_id: number | null
          sumit_customer_id: number | null
          sumit_order_document_id: number | null
          template_id: string | null
          thankyou_auto_enabled: boolean
          thankyou_send_at: string | null
          thankyou_sent_at: string | null
          tos_version: string | null
          updated_at: string
        }
        Insert: {
          allowed_channels?: Database["public"]["Enums"]["campaign_channel"][]
          approved_at?: string | null
          approved_by?: string | null
          auth_amount?: number | null
          auth_expires_at?: string | null
          auth_external_ref?: string | null
          auth_number?: string | null
          authorized_at?: string | null
          base_price?: number | null
          billing_route?: Database["public"]["Enums"]["billing_route"] | null
          capture_status?: string | null
          card_citizen_id?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_token_ref?: string | null
          charge_auth_number?: string | null
          charge_document_number?: number | null
          charge_document_url?: string | null
          charge_payment_id?: number | null
          charge_status?: string | null
          charged_at?: string | null
          close_at?: string | null
          created_at?: string
          credit_applied?: number
          enabled?: boolean
          event_id: string
          final_charge_amount?: number | null
          final_invoice_document_id?: number | null
          hold_order_document_id?: number | null
          hold_order_document_number?: number | null
          hold_order_document_url?: string | null
          id?: string
          included_reached?: number | null
          max_charge_ceiling?: number | null
          max_contacts: number
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          release_status?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          steps?: Json
          sumit_charge_document_id?: number | null
          sumit_customer_id?: number | null
          sumit_order_document_id?: number | null
          template_id?: string | null
          thankyou_auto_enabled?: boolean
          thankyou_send_at?: string | null
          thankyou_sent_at?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Update: {
          allowed_channels?: Database["public"]["Enums"]["campaign_channel"][]
          approved_at?: string | null
          approved_by?: string | null
          auth_amount?: number | null
          auth_expires_at?: string | null
          auth_external_ref?: string | null
          auth_number?: string | null
          authorized_at?: string | null
          base_price?: number | null
          billing_route?: Database["public"]["Enums"]["billing_route"] | null
          capture_status?: string | null
          card_citizen_id?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_token_ref?: string | null
          charge_auth_number?: string | null
          charge_document_number?: number | null
          charge_document_url?: string | null
          charge_payment_id?: number | null
          charge_status?: string | null
          charged_at?: string | null
          close_at?: string | null
          created_at?: string
          credit_applied?: number
          enabled?: boolean
          event_id?: string
          final_charge_amount?: number | null
          final_invoice_document_id?: number | null
          hold_order_document_id?: number | null
          hold_order_document_number?: number | null
          hold_order_document_url?: string | null
          id?: string
          included_reached?: number | null
          max_charge_ceiling?: number | null
          max_contacts?: number
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          release_status?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          steps?: Json
          sumit_charge_document_id?: number | null
          sumit_customer_id?: number | null
          sumit_order_document_id?: number | null
          template_id?: string | null
          thankyou_auto_enabled?: boolean
          thankyou_send_at?: string | null
          thankyou_sent_at?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          is_built: boolean
          key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          is_built?: boolean
          key: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          is_built?: boolean
          key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      console_agent_calendar_presence: {
        Row: {
          agent_id: string
          busy_until: string | null
          last_error_code: string | null
          show_as: string | null
          synced_at: string
        }
        Insert: {
          agent_id: string
          busy_until?: string | null
          last_error_code?: string | null
          show_as?: string | null
          synced_at?: string
        }
        Update: {
          agent_id?: string
          busy_until?: string | null
          last_error_code?: string | null
          show_as?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_agent_calendar_presence_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_calendar_presence_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_calendar_presence_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_agent_commands: {
        Row: {
          agent_id: string
          applied: string
          call_attempt_id: string
          command: string
          command_text: string | null
          created_at: string
          delivered: boolean
          event_id: string | null
          id: string
          request_id: string
        }
        Insert: {
          agent_id: string
          applied?: string
          call_attempt_id: string
          command: string
          command_text?: string | null
          created_at?: string
          delivered: boolean
          event_id?: string | null
          id?: string
          request_id: string
        }
        Update: {
          agent_id?: string
          applied?: string
          call_attempt_id?: string
          command?: string
          command_text?: string | null
          created_at?: string
          delivered?: boolean
          event_id?: string | null
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_agent_commands_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "console_agent_commands_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "console_agent_commands_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      console_agent_queues: {
        Row: {
          agent_id: string
          created_at: string
          queue_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          queue_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          queue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_agent_queues_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_queues_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_queues_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_queues_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "console_queues"
            referencedColumns: ["id"]
          },
        ]
      }
      console_agent_secrets: {
        Row: {
          created_at: string
          rotated_at: string | null
          user_id: string
          vox_password: string
        }
        Insert: {
          created_at?: string
          rotated_at?: string | null
          user_id: string
          vox_password: string
        }
        Update: {
          created_at?: string
          rotated_at?: string | null
          user_id?: string
          vox_password?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_agent_secrets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_secrets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_secrets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_agent_shift: {
        Row: {
          active: boolean
          agent_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_agent_shift_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_shift_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_agent_shift_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_agents: {
        Row: {
          created_at: string
          display_name: string
          user_id: string
          vox_active: boolean
          vox_user_id: number | null
          vox_username: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          user_id: string
          vox_active?: boolean
          vox_user_id?: number | null
          vox_username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          user_id?: string
          vox_active?: boolean
          vox_user_id?: number | null
          vox_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "console_agents_staff_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "platform_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_call_feed: {
        Row: {
          agent_id: string | null
          call_attempt_id: string
          call_duration_sec: number | null
          callback_iso: string | null
          campaign_id: string | null
          created_at: string
          direction: string
          event_id: string | null
          finish_reason: string | null
          handled_by: string
          kind: string
          participation_state: string | null
          rsvp_digit: string | null
          status: string | null
          takeover_claimed_at: string | null
          takeover_request_id: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          call_attempt_id: string
          call_duration_sec?: number | null
          callback_iso?: string | null
          campaign_id?: string | null
          created_at?: string
          direction?: string
          event_id?: string | null
          finish_reason?: string | null
          handled_by?: string
          kind?: string
          participation_state?: string | null
          rsvp_digit?: string | null
          status?: string | null
          takeover_claimed_at?: string | null
          takeover_request_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          call_attempt_id?: string
          call_duration_sec?: number | null
          callback_iso?: string | null
          campaign_id?: string | null
          created_at?: string
          direction?: string
          event_id?: string | null
          finish_reason?: string | null
          handled_by?: string
          kind?: string
          participation_state?: string | null
          rsvp_digit?: string | null
          status?: string | null
          takeover_claimed_at?: string | null
          takeover_request_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_call_feed_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: true
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      console_call_pii: {
        Row: {
          call_id: string
          created_at: string
          dial_token_expires_at: string | null
          dial_token_hash: string | null
          origin_ip_hash: string | null
          phone_e164: string | null
          recording_url: string | null
          secure_session_url: string | null
          session_url: string | null
          vox_session_id: number | null
        }
        Insert: {
          call_id: string
          created_at?: string
          dial_token_expires_at?: string | null
          dial_token_hash?: string | null
          origin_ip_hash?: string | null
          phone_e164?: string | null
          recording_url?: string | null
          secure_session_url?: string | null
          session_url?: string | null
          vox_session_id?: number | null
        }
        Update: {
          call_id?: string
          created_at?: string
          dial_token_expires_at?: string | null
          dial_token_hash?: string | null
          origin_ip_hash?: string | null
          phone_e164?: string | null
          recording_url?: string | null
          secure_session_url?: string | null
          session_url?: string | null
          vox_session_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "console_call_pii_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "console_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      console_calls: {
        Row: {
          agent_id: string | null
          answered_at: string | null
          call_attempt_id: string | null
          caller_masked: string | null
          conference_agent_ids: Json
          consult_agent_id: string | null
          consult_connected_at: string | null
          contact_id: string | null
          created_at: string
          direction: string
          disclosure_played: boolean
          duration_sec: number | null
          ended_at: string | null
          ended_reason: string | null
          event_id: string | null
          guest_id: string | null
          has_recording: boolean
          id: string
          kind: string
          peer_agent_id: string | null
          queue_id: string | null
          started_at: string
          status: string
          transferred_to_agent_id: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          answered_at?: string | null
          call_attempt_id?: string | null
          caller_masked?: string | null
          conference_agent_ids?: Json
          consult_agent_id?: string | null
          consult_connected_at?: string | null
          contact_id?: string | null
          created_at?: string
          direction: string
          disclosure_played?: boolean
          duration_sec?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id?: string | null
          guest_id?: string | null
          has_recording?: boolean
          id?: string
          kind: string
          peer_agent_id?: string | null
          queue_id?: string | null
          started_at?: string
          status?: string
          transferred_to_agent_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          answered_at?: string | null
          call_attempt_id?: string | null
          caller_masked?: string | null
          conference_agent_ids?: Json
          consult_agent_id?: string | null
          consult_connected_at?: string | null
          contact_id?: string | null
          created_at?: string
          direction?: string
          disclosure_played?: boolean
          duration_sec?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          event_id?: string | null
          guest_id?: string | null
          has_recording?: boolean
          id?: string
          kind?: string
          peer_agent_id?: string | null
          queue_id?: string | null
          started_at?: string
          status?: string
          transferred_to_agent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "console_calls_consult_agent_id_fkey"
            columns: ["consult_agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_consult_agent_id_fkey"
            columns: ["consult_agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_consult_agent_id_fkey"
            columns: ["consult_agent_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "console_calls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "console_calls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "console_calls_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "console_event_guests"
            referencedColumns: ["guest_id"]
          },
          {
            foreignKeyName: "console_calls_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "console_calls_peer_agent_id_fkey"
            columns: ["peer_agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_peer_agent_id_fkey"
            columns: ["peer_agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_peer_agent_id_fkey"
            columns: ["peer_agent_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "console_queues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "console_calls_transferred_to_agent_id_fkey"
            columns: ["transferred_to_agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_transferred_to_agent_id_fkey"
            columns: ["transferred_to_agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_calls_transferred_to_agent_id_fkey"
            columns: ["transferred_to_agent_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_chat_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "console_chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_queues: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          name_he: string
          priority: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          name_he: string
          priority?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          name_he?: string
          priority?: number
        }
        Relationships: []
      }
      contact_interactions: {
        Row: {
          billable: boolean
          campaign_id: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          contact_id: string | null
          context_message_id: string | null
          created_at: string
          delivery_error_code: string | null
          delivery_status: string | null
          direction: string
          event_id: string | null
          guest_id: string | null
          id: string
          kind: string
          message_key: string | null
          payload_meta: Json | null
          provider_id: string
        }
        Insert: {
          billable?: boolean
          campaign_id?: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          contact_id?: string | null
          context_message_id?: string | null
          created_at?: string
          delivery_error_code?: string | null
          delivery_status?: string | null
          direction: string
          event_id?: string | null
          guest_id?: string | null
          id?: string
          kind: string
          message_key?: string | null
          payload_meta?: Json | null
          provider_id: string
        }
        Update: {
          billable?: boolean
          campaign_id?: string | null
          channel?: Database["public"]["Enums"]["campaign_channel"]
          contact_id?: string | null
          context_message_id?: string | null
          created_at?: string
          delivery_error_code?: string | null
          delivery_status?: string | null
          direction?: string
          event_id?: string | null
          guest_id?: string | null
          id?: string
          kind?: string
          message_key?: string | null
          payload_meta?: Json | null
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_interactions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_interactions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_interactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "contact_interactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_interactions_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "console_event_guests"
            referencedColumns: ["guest_id"]
          },
          {
            foreignKeyName: "contact_interactions_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          auto_closed_at: string | null
          closing_warning_sent_at: string | null
          created_at: string
          draft_created_at: string | null
          draft_reply: string | null
          email: string | null
          handled_at: string | null
          id: string
          internal_note: string | null
          last_activity_at: string
          message: string
          name: string
          phone: string | null
          queue_id: string | null
          rating_at: string | null
          rating_comment: string | null
          rating_requested_at: string | null
          rating_score: number | null
          rating_token: string | null
          ref_code: string
          reminder_sent_at: string | null
          replied_at: string | null
          reply_needed_at: string | null
          sent_reply: string | null
          source: string
          source_message_id: string | null
          status: string
          thread_id: string | null
          topic: string | null
          user_id: string | null
        }
        Insert: {
          auto_closed_at?: string | null
          closing_warning_sent_at?: string | null
          created_at?: string
          draft_created_at?: string | null
          draft_reply?: string | null
          email?: string | null
          handled_at?: string | null
          id?: string
          internal_note?: string | null
          last_activity_at?: string
          message: string
          name: string
          phone?: string | null
          queue_id?: string | null
          rating_at?: string | null
          rating_comment?: string | null
          rating_requested_at?: string | null
          rating_score?: number | null
          rating_token?: string | null
          ref_code?: string
          reminder_sent_at?: string | null
          replied_at?: string | null
          reply_needed_at?: string | null
          sent_reply?: string | null
          source?: string
          source_message_id?: string | null
          status?: string
          thread_id?: string | null
          topic?: string | null
          user_id?: string | null
        }
        Update: {
          auto_closed_at?: string | null
          closing_warning_sent_at?: string | null
          created_at?: string
          draft_created_at?: string | null
          draft_reply?: string | null
          email?: string | null
          handled_at?: string | null
          id?: string
          internal_note?: string | null
          last_activity_at?: string
          message?: string
          name?: string
          phone?: string | null
          queue_id?: string | null
          rating_at?: string | null
          rating_comment?: string | null
          rating_requested_at?: string | null
          rating_score?: number | null
          rating_token?: string | null
          ref_code?: string
          reminder_sent_at?: string | null
          replied_at?: string | null
          reply_needed_at?: string | null
          sent_reply?: string | null
          source?: string
          source_message_id?: string | null
          status?: string
          thread_id?: string | null
          topic?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_messages_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "console_queues"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          call_consent_at: string | null
          created_at: string
          event_id: string
          id: string
          normalized_phone: string
          op_status: Database["public"]["Enums"]["contact_op_status"]
          removal_requested: boolean
          updated_at: string
          whatsapp_consent_at: string | null
        }
        Insert: {
          call_consent_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          normalized_phone: string
          op_status?: Database["public"]["Enums"]["contact_op_status"]
          removal_requested?: boolean
          updated_at?: string
          whatsapp_consent_at?: string | null
        }
        Update: {
          call_consent_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          normalized_phone?: string
          op_status?: Database["public"]["Enums"]["contact_op_status"]
          removal_requested?: boolean
          updated_at?: string
          whatsapp_consent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "contacts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_cancellation_requests: {
        Row: {
          capture_outcome: string | null
          created_at: string
          event_id: string
          id: string
          owner_id: string
          reason: string
          request_number: number
          resolution: string | null
          resolution_amount: number | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          sms_consent: boolean
          status: string
          sumit_document_id: number | null
          sumit_document_url: string | null
          updated_at: string
        }
        Insert: {
          capture_outcome?: string | null
          created_at?: string
          event_id: string
          id?: string
          owner_id: string
          reason: string
          request_number?: never
          resolution?: string | null
          resolution_amount?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sms_consent?: boolean
          status?: string
          sumit_document_id?: number | null
          sumit_document_url?: string | null
          updated_at?: string
        }
        Update: {
          capture_outcome?: string | null
          created_at?: string
          event_id?: string
          id?: string
          owner_id?: string
          reason?: string
          request_number?: never
          resolution?: string | null
          resolution_amount?: number | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sms_consent?: boolean
          status?: string
          sumit_document_id?: number | null
          sumit_document_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_cancellation_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_cancellation_requests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_questions: {
        Row: {
          created_at: string
          enabled: boolean
          event_id: string
          id: string
          label: string
          options: Json | null
          q_key: string
          q_type: string
          required: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_id: string
          id?: string
          label: string
          options?: Json | null
          q_key: string
          q_type?: string
          required?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_id?: string
          id?: string
          label?: string
          options?: Json | null
          q_key?: string
          q_type?: string
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_questions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_questions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          celebrants: Json | null
          created_at: string
          event_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          gift_link_token: string
          gift_payment_url: string | null
          id: string
          invite_image_path: string | null
          name: string
          notes: string | null
          org_id: string | null
          owner_id: string
          package_id: string | null
          rsvp_deadline: string | null
          show_meal_pref: boolean
          status: Database["public"]["Enums"]["event_status"]
          template: string | null
          updated_at: string
          venue_address: string | null
          venue_name: string | null
          with_ai_calls: boolean
        }
        Insert: {
          celebrants?: Json | null
          created_at?: string
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          gift_link_token?: string
          gift_payment_url?: string | null
          id?: string
          invite_image_path?: string | null
          name: string
          notes?: string | null
          org_id?: string | null
          owner_id: string
          package_id?: string | null
          rsvp_deadline?: string | null
          show_meal_pref?: boolean
          status?: Database["public"]["Enums"]["event_status"]
          template?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
          with_ai_calls?: boolean
        }
        Update: {
          celebrants?: Json | null
          created_at?: string
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          gift_link_token?: string
          gift_payment_url?: string | null
          id?: string
          invite_image_path?: string | null
          name?: string
          notes?: string | null
          org_id?: string | null
          owner_id?: string
          package_id?: string | null
          rsvp_deadline?: string | null
          show_meal_pref?: boolean
          status?: Database["public"]["Enums"]["event_status"]
          template?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
          with_ai_calls?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_availability_blocks: {
        Row: {
          appointment_id: string
          connection_id: string
          created_at: string
          ends_at: string
          id: string
          label: string
          show_as: string
          starts_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_id: string
          connection_id: string
          created_at?: string
          ends_at: string
          id?: string
          label: string
          show_as: string
          starts_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_id?: string
          connection_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          label?: string
          show_as?: string
          starts_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_availability_blocks_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_availability_blocks_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections_status"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_calendar_links: {
        Row: {
          appointment_id: string
          connection_id: string
          created_at: string
          event_id: string
          id: string
          rsvp_deadline_appointment_id: string | null
          subject_synced: string | null
          updated_at: string
        }
        Insert: {
          appointment_id: string
          connection_id: string
          created_at?: string
          event_id: string
          id?: string
          rsvp_deadline_appointment_id?: string | null
          subject_synced?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          connection_id?: string
          created_at?: string
          event_id?: string
          id?: string
          rsvp_deadline_appointment_id?: string | null
          subject_synced?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_calendar_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_calendar_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_calendar_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "exchange_calendar_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_connections: {
        Row: {
          auth_method: string
          created_at: string
          credential_auth_tag: string | null
          credential_ciphertext: string | null
          credential_iv: string | null
          encryption_key_version: number
          id: string
          last_error: string | null
          last_verified_at: string | null
          mailbox_email: string
          org_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_method?: string
          created_at?: string
          credential_auth_tag?: string | null
          credential_ciphertext?: string | null
          credential_iv?: string | null
          encryption_key_version?: number
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          mailbox_email: string
          org_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_method?: string
          created_at?: string
          credential_auth_tag?: string | null
          credential_ciphertext?: string | null
          credential_iv?: string | null
          encryption_key_version?: number
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          mailbox_email?: string
          org_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_items: {
        Row: {
          answer: string
          category: Database["public"]["Enums"]["faq_category"]
          created_at: string
          id: string
          is_structural: boolean
          item_key: string | null
          published: boolean
          question: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer?: string
          category: Database["public"]["Enums"]["faq_category"]
          created_at?: string
          id?: string
          is_structural?: boolean
          item_key?: string | null
          published?: boolean
          question: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: Database["public"]["Enums"]["faq_category"]
          created_at?: string
          id?: string
          is_structural?: boolean
          item_key?: string | null
          published?: boolean
          question?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fleet_goals: {
        Row: {
          body: string
          closed_at: string | null
          consecutive_failures: number
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          next_wake_at: string | null
          role: string
          state: Json
          status: string
          step_count: number
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          closed_at?: string | null
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          next_wake_at?: string | null
          role: string
          state?: Json
          status?: string
          step_count?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          closed_at?: string | null
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          next_wake_at?: string | null
          role?: string
          state?: Json
          status?: string
          step_count?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      fleet_request_slack_threads: {
        Row: {
          created_at: string
          request_id: string
          thread_ts: string
        }
        Insert: {
          created_at?: string
          request_id: string
          thread_ts: string
        }
        Update: {
          created_at?: string
          request_id?: string
          thread_ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_request_slack_threads_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "fleet_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_requests: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          body: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          request_key: string
          role: string
          run_id: string | null
          status: string
          tier: number
          title: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          body: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          payload?: Json
          request_key: string
          role: string
          run_id?: string | null
          status?: string
          tier?: number
          title: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          body?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          request_key?: string
          role?: string
          run_id?: string | null
          status?: string
          tier?: number
          title?: string
        }
        Relationships: []
      }
      fleet_social_posts: {
        Row: {
          attempt_count: number
          caption_sha256: string
          created_at: string
          error: string | null
          external_post_id: string | null
          id: string
          image_sha256: string | null
          permalink: string | null
          platform: string
          published_at: string | null
          request_id: string
          status: string
        }
        Insert: {
          attempt_count?: number
          caption_sha256: string
          created_at?: string
          error?: string | null
          external_post_id?: string | null
          id?: string
          image_sha256?: string | null
          permalink?: string | null
          platform: string
          published_at?: string | null
          request_id: string
          status: string
        }
        Update: {
          attempt_count?: number
          caption_sha256?: string
          created_at?: string
          error?: string | null
          external_post_id?: string | null
          id?: string
          image_sha256?: string | null
          permalink?: string | null
          platform?: string
          published_at?: string | null
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_social_posts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "fleet_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_groups: {
        Row: {
          color: string | null
          created_at: string
          event_id: string
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          event_id: string
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          event_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_import_staging: {
        Row: {
          created_at: string
          error_rows: Json
          event_id: string
          file_name: string | null
          id: string
          resolved_at: string | null
          row_count: number
          rows: Json
          sender_phone: string
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          error_rows?: Json
          event_id: string
          file_name?: string | null
          id?: string
          resolved_at?: string | null
          row_count: number
          rows: Json
          sender_phone: string
          source: string
          status?: string
        }
        Update: {
          created_at?: string
          error_rows?: Json
          event_id?: string
          file_name?: string | null
          id?: string
          resolved_at?: string | null
          row_count?: number
          rows?: Json
          sender_phone?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_import_staging_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guest_import_staging_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          callback_requested: boolean
          confirmed_adults: number | null
          confirmed_headcount: number
          confirmed_kids: number | null
          contact_id: string | null
          contact_status: Database["public"]["Enums"]["contact_status"]
          created_at: string
          event_id: string
          expected_count: number | null
          extras: Json
          full_name: string
          group_id: string | null
          headcount_answered_at: string | null
          headcount_attempts: number
          headcount_requested_at: string | null
          id: string
          language: string | null
          meal_pref: string | null
          note: string | null
          phone: string | null
          rsvp_note: string | null
          rsvp_token: string
          rsvp_token_revoked_at: string | null
          show_in_guest_list: boolean
          status: Database["public"]["Enums"]["guest_status"]
          updated_at: string
        }
        Insert: {
          callback_requested?: boolean
          confirmed_adults?: number | null
          confirmed_headcount?: number
          confirmed_kids?: number | null
          contact_id?: string | null
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          event_id: string
          expected_count?: number | null
          extras?: Json
          full_name: string
          group_id?: string | null
          headcount_answered_at?: string | null
          headcount_attempts?: number
          headcount_requested_at?: string | null
          id?: string
          language?: string | null
          meal_pref?: string | null
          note?: string | null
          phone?: string | null
          rsvp_note?: string | null
          rsvp_token?: string
          rsvp_token_revoked_at?: string | null
          show_in_guest_list?: boolean
          status?: Database["public"]["Enums"]["guest_status"]
          updated_at?: string
        }
        Update: {
          callback_requested?: boolean
          confirmed_adults?: number | null
          confirmed_headcount?: number
          confirmed_kids?: number | null
          contact_id?: string | null
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          event_id?: string
          expected_count?: number | null
          extras?: Json
          full_name?: string
          group_id?: string | null
          headcount_answered_at?: string | null
          headcount_attempts?: number
          headcount_requested_at?: string | null
          id?: string
          language?: string | null
          meal_pref?: string | null
          note?: string | null
          phone?: string | null
          rsvp_note?: string | null
          rsvp_token?: string
          rsvp_token_revoked_at?: string | null
          show_in_guest_list?: boolean
          status?: Database["public"]["Enums"]["guest_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      human_agent_call_legs: {
        Row: {
          agent_id: string | null
          call_attempt_id: string
          connected_at: string | null
          device_id: string | null
          disconnected_at: string | null
          failure_code: string | null
          id: string
          metadata: Json
          mode: string
          request_id: string
          requested_at: string
          status: string
          vox_leg_call_id: string | null
          vox_sdk_call_id: string | null
        }
        Insert: {
          agent_id?: string | null
          call_attempt_id: string
          connected_at?: string | null
          device_id?: string | null
          disconnected_at?: string | null
          failure_code?: string | null
          id?: string
          metadata?: Json
          mode: string
          request_id: string
          requested_at?: string
          status: string
          vox_leg_call_id?: string | null
          vox_sdk_call_id?: string | null
        }
        Update: {
          agent_id?: string | null
          call_attempt_id?: string
          connected_at?: string | null
          device_id?: string | null
          disconnected_at?: string | null
          failure_code?: string | null
          id?: string
          metadata?: Json
          mode?: string
          request_id?: string
          requested_at?: string
          status?: string
          vox_leg_call_id?: string | null
          vox_sdk_call_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "human_agent_call_legs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "human_agent_call_legs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_agents_roster"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "human_agent_call_legs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "console_me"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "human_agent_call_legs_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_agent_attempts: {
        Row: {
          call_duration_sec: number | null
          console_call_id: string
          contact_id: string
          conversation_started_at: string | null
          created_at: string
          el_conversation_id: string | null
          event_id: string
          finish_reason: string | null
          guest_id: string
          id: string
          revoked_at: string | null
          status: string
          token_expires_at: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          call_duration_sec?: number | null
          console_call_id: string
          contact_id: string
          conversation_started_at?: string | null
          created_at?: string
          el_conversation_id?: string | null
          event_id: string
          finish_reason?: string | null
          guest_id: string
          id?: string
          revoked_at?: string | null
          status?: string
          token_expires_at: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          call_duration_sec?: number | null
          console_call_id?: string
          contact_id?: string
          conversation_started_at?: string | null
          created_at?: string
          el_conversation_id?: string | null
          event_id?: string
          finish_reason?: string | null
          guest_id?: string
          id?: string
          revoked_at?: string | null
          status?: string
          token_expires_at?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_agent_attempts_console_call_id_fkey"
            columns: ["console_call_id"]
            isOneToOne: false
            referencedRelation: "console_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_agent_attempts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_agent_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "inbound_agent_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_agent_attempts_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "console_event_guests"
            referencedColumns: ["guest_id"]
          },
          {
            foreignKeyName: "inbound_agent_attempts_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiry_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          direction: string
          id: string
          inquiry_id: string
          message_id: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          direction: string
          id?: string
          inquiry_id: string
          message_id?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          direction?: string
          id?: string
          inquiry_id?: string
          message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inquiry_messages_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "contact_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          active: boolean
          body: string | null
          category: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          components: Json | null
          created_at: string
          id: string
          label: string | null
          language: string
          last_synced_at: string | null
          message_key: string
          meta_status: string | null
          meta_template_id: string | null
          name: string
          pending_category_change_at: string | null
          pending_correct_category: string | null
          quality_score: string | null
          rejected_reason: string | null
          requested_category: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string | null
          category?: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          components?: Json | null
          created_at?: string
          id?: string
          label?: string | null
          language?: string
          last_synced_at?: string | null
          message_key: string
          meta_status?: string | null
          meta_template_id?: string | null
          name?: string
          pending_category_change_at?: string | null
          pending_correct_category?: string | null
          quality_score?: string | null
          rejected_reason?: string | null
          requested_category?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string | null
          category?: string | null
          channel?: Database["public"]["Enums"]["campaign_channel"]
          components?: Json | null
          created_at?: string
          id?: string
          label?: string | null
          language?: string
          last_synced_at?: string | null
          message_key?: string
          meta_status?: string | null
          meta_template_id?: string | null
          name?: string
          pending_category_change_at?: string | null
          pending_correct_category?: string | null
          quality_score?: string | null
          rejected_reason?: string | null
          requested_category?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_alerts: {
        Row: {
          category: string | null
          created_at: string
          delivered: boolean
          id: string
          level: string
          source: string | null
          suppressed_count: number
          title: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          delivered?: boolean
          id?: string
          level: string
          source?: string | null
          suppressed_count?: number
          title: string
        }
        Update: {
          category?: string | null
          created_at?: string
          delivered?: boolean
          id?: string
          level?: string
          source?: string | null
          suppressed_count?: number
          title?: string
        }
        Relationships: []
      }
      ops_errors: {
        Row: {
          deploy_id: string | null
          digest: string | null
          error_name: string | null
          id: string
          method: string | null
          occurred_at: string
          occurrences: number
          route_path: string | null
          route_type: string | null
          runtime: string | null
        }
        Insert: {
          deploy_id?: string | null
          digest?: string | null
          error_name?: string | null
          id?: string
          method?: string | null
          occurred_at?: string
          occurrences?: number
          route_path?: string | null
          route_type?: string | null
          runtime?: string | null
        }
        Update: {
          deploy_id?: string | null
          digest?: string | null
          error_name?: string | null
          id?: string
          method?: string | null
          occurred_at?: string
          occurrences?: number
          route_path?: string | null
          route_type?: string | null
          runtime?: string | null
        }
        Relationships: []
      }
      org_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_owner_role: boolean
          label: string
          name: string
          rank: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_owner_role?: boolean
          label: string
          name: string
          rank?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_owner_role?: boolean
          label?: string
          name?: string
          rank?: number
          sort_order?: number
        }
        Relationships: []
      }
      organization_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          details: Json | null
          id: string
          organization_id: string
          target_role_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          details?: Json | null
          id?: string
          organization_id: string
          target_role_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          organization_id?: string
          target_role_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_audit_log_target_role_id_fkey"
            columns: ["target_role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          revoked_at: string | null
          role_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          revoked_at?: string | null
          role_id: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          revoked_at?: string | null
          role_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_role_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          organization_id: string
          target_role_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          organization_id: string
          target_role_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          organization_id?: string
          target_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_role_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_role_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          organization_id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          organization_id: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          organization_id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_role_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permission_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      otp_challenges: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          phone: string
          purpose: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          purpose: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          purpose?: string
        }
        Relationships: []
      }
      outreach_state: {
        Row: {
          call_request_count: number
          campaign_id: string
          contact_id: string
          created_at: string
          current_step_index: number
          dispatched_at: string | null
          dispatched_job_id: string | null
          event_id: string
          id: string
          next_run_at: string | null
          plan_rev: string | null
          planned_at: string | null
          planned_step_index: number | null
          reached_at: string | null
          reached_channel:
            | Database["public"]["Enums"]["campaign_channel"]
            | null
          status: string
          stop_reason: string | null
          updated_at: string
          whatsapp_sent_count: number
        }
        Insert: {
          call_request_count?: number
          campaign_id: string
          contact_id: string
          created_at?: string
          current_step_index?: number
          dispatched_at?: string | null
          dispatched_job_id?: string | null
          event_id: string
          id?: string
          next_run_at?: string | null
          plan_rev?: string | null
          planned_at?: string | null
          planned_step_index?: number | null
          reached_at?: string | null
          reached_channel?:
            | Database["public"]["Enums"]["campaign_channel"]
            | null
          status?: string
          stop_reason?: string | null
          updated_at?: string
          whatsapp_sent_count?: number
        }
        Update: {
          call_request_count?: number
          campaign_id?: string
          contact_id?: string
          created_at?: string
          current_step_index?: number
          dispatched_at?: string | null
          dispatched_job_id?: string | null
          event_id?: string
          id?: string
          next_run_at?: string | null
          plan_rev?: string | null
          planned_at?: string | null
          planned_step_index?: number | null
          reached_at?: string | null
          reached_channel?:
            | Database["public"]["Enums"]["campaign_channel"]
            | null
          status?: string
          stop_reason?: string | null
          updated_at?: string
          whatsapp_sent_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_state_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "outreach_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_template_failures: {
        Row: {
          campaign_id: string
          channel: Database["public"]["Enums"]["campaign_channel"]
          created_at: string
          id: string
          message_key: string
          reason: string
          touchpoint_index: number
        }
        Insert: {
          campaign_id: string
          channel: Database["public"]["Enums"]["campaign_channel"]
          created_at?: string
          id?: string
          message_key: string
          reason: string
          touchpoint_index: number
        }
        Update: {
          campaign_id?: string
          channel?: Database["public"]["Enums"]["campaign_channel"]
          created_at?: string
          id?: string
          message_key?: string
          reason?: string
          touchpoint_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "outreach_template_failures_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_template_failures_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          active: boolean
          base_price: number | null
          category: string
          channels: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at: string
          description: string | null
          hold_buffer_pct: number
          id: string
          included_reached: number | null
          includes: Json
          min_hold_floor: number
          name: string
          outreach_schedule: Json | null
          price_per_reached: number | null
          price_with_vat: number
          sort_order: number
          tier: string
        }
        Insert: {
          active?: boolean
          base_price?: number | null
          category?: string
          channels?: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at?: string
          description?: string | null
          hold_buffer_pct?: number
          id?: string
          included_reached?: number | null
          includes?: Json
          min_hold_floor?: number
          name: string
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          price_with_vat: number
          sort_order?: number
          tier: string
        }
        Update: {
          active?: boolean
          base_price?: number | null
          category?: string
          channels?: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at?: string
          description?: string | null
          hold_buffer_pct?: number
          id?: string
          included_reached?: number | null
          includes?: Json
          min_hold_floor?: number
          name?: string
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          price_with_vat?: number
          sort_order?: number
          tier?: string
        }
        Relationships: []
      }
      permission_definitions: {
        Row: {
          action: string
          created_at: string
          id: string
          label: string
          resource: string
          sort_order: number
          system_protected: boolean
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          label: string
          resource: string
          sort_order?: number
          system_protected?: boolean
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          label?: string
          resource?: string
          sort_order?: number
          system_protected?: boolean
        }
        Relationships: []
      }
      platform_permission_definitions: {
        Row: {
          category: string
          created_at: string
          id: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      platform_role_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_role_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_role_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_role_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      platform_role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "platform_permission_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "platform_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_owner_role: boolean
          label: string
          name: string
          rank: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_owner_role?: boolean
          label: string
          name: string
          rank?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_owner_role?: boolean
          label?: string
          name?: string
          rank?: number
          sort_order?: number
        }
        Relationships: []
      }
      platform_staff: {
        Row: {
          created_at: string
          granted_by: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_staff_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "platform_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          sales_referral_attempt_id: string | null
          terms_accepted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          sales_referral_attempt_id?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          sales_referral_attempt_id?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_delivery_log: {
        Row: {
          created_at: string
          endpoint_host: string | null
          error_message: string | null
          event_id: string | null
          id: string
          notification_type: string
          org_id: string | null
          payload: Json
          sent_at: string
          status_code: number | null
          subscription_id: string | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint_host?: string | null
          error_message?: string | null
          event_id?: string | null
          id?: string
          notification_type?: string
          org_id?: string | null
          payload?: Json
          sent_at?: string
          status_code?: number | null
          subscription_id?: string | null
          success: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint_host?: string | null
          error_message?: string | null
          event_id?: string | null
          id?: string
          notification_type?: string
          org_id?: string | null
          payload?: Json
          sent_at?: string
          status_code?: number | null
          subscription_id?: string | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "push_delivery_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          expiration_time: string | null
          failure_count: number
          id: string
          last_error: string | null
          last_seen_at: string
          org_id: string | null
          p256dh_key: string
          revoked_at: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          expiration_time?: string | null
          failure_count?: number
          id?: string
          last_error?: string | null
          last_seen_at?: string
          org_id?: string | null
          p256dh_key: string
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          expiration_time?: string | null
          failure_count?: number
          id?: string
          last_error?: string | null
          last_seen_at?: string
          org_id?: string | null
          p256dh_key?: string
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permission_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "org_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvp_responses: {
        Row: {
          adults: number | null
          attending: boolean | null
          created_at: string
          event_id: string
          extras: Json
          guest_id: string
          id: string
          kids: number | null
          meal_pref: string | null
          note: string | null
        }
        Insert: {
          adults?: number | null
          attending?: boolean | null
          created_at?: string
          event_id: string
          extras?: Json
          guest_id: string
          id?: string
          kids?: number | null
          meal_pref?: string | null
          note?: string | null
        }
        Update: {
          adults?: number | null
          attending?: boolean | null
          created_at?: string
          event_id?: string
          extras?: Json
          guest_id?: string
          id?: string
          kids?: number | null
          meal_pref?: string | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "rsvp_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_responses_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "console_event_guests"
            referencedColumns: ["guest_id"]
          },
          {
            foreignKeyName: "rsvp_responses_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_call_attempts: {
        Row: {
          access_token: string
          call_duration_sec: number | null
          callback_request_id: string
          created_at: string
          dispatch_status: string
          el_conversation_id: string | null
          finish_reason: string | null
          id: string
          outcome_recorded_at: string | null
          scheduled_at_snapshot: string
          signup_completed_at: string | null
          token_expires_at: string
          updated_at: string
          vox_call_session_history_id: string | null
          wa_consent_confirmed_at: string | null
          wa_delivery_error_code: string | null
          wa_delivery_status: string | null
          wa_fallback_attempted_at: string | null
          wa_message_id: string | null
          wa_status_at: string | null
          call_analysis: {
            agent_id: string | null
            agent_turns: number | null
            analysis_at: string | null
            call_attempt_id: string | null
            call_duration_secs: number | null
            call_successful: string | null
            conversation_id: string
            cost_credits: number | null
            cost_fiat: number | null
            el_call_score: number | null
            el_data: Json | null
            el_eval: Json | null
            event_id: string | null
            frustration_score: number | null
            id: string
            linked_at: string | null
            overall_score: number | null
            provider: string
            received_at: string
            rsvp_persisted: boolean | null
            sentiment_label: string | null
            status: string | null
            summary_title: string | null
            termination_reason: string | null
            transcript_summary: string | null
            user_turns: number | null
            voicemail_detected: boolean | null
          } | null
        }
        Insert: {
          access_token: string
          call_duration_sec?: number | null
          callback_request_id: string
          created_at?: string
          dispatch_status?: string
          el_conversation_id?: string | null
          finish_reason?: string | null
          id?: string
          outcome_recorded_at?: string | null
          scheduled_at_snapshot: string
          signup_completed_at?: string | null
          token_expires_at: string
          updated_at?: string
          vox_call_session_history_id?: string | null
          wa_consent_confirmed_at?: string | null
          wa_delivery_error_code?: string | null
          wa_delivery_status?: string | null
          wa_fallback_attempted_at?: string | null
          wa_message_id?: string | null
          wa_status_at?: string | null
        }
        Update: {
          access_token?: string
          call_duration_sec?: number | null
          callback_request_id?: string
          created_at?: string
          dispatch_status?: string
          el_conversation_id?: string | null
          finish_reason?: string | null
          id?: string
          outcome_recorded_at?: string | null
          scheduled_at_snapshot?: string
          signup_completed_at?: string | null
          token_expires_at?: string
          updated_at?: string
          vox_call_session_history_id?: string | null
          wa_consent_confirmed_at?: string | null
          wa_delivery_error_code?: string | null
          wa_delivery_status?: string | null
          wa_fallback_attempted_at?: string | null
          wa_message_id?: string | null
          wa_status_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_call_attempts_callback_request_id_fkey"
            columns: ["callback_request_id"]
            isOneToOne: false
            referencedRelation: "callback_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      signed_agreements: {
        Row: {
          agreement_version: string
          campaign_id: string
          content_hash: string
          created_at: string
          event_id: string
          id: string
          id_document_ref: string | null
          ip: string | null
          otp_verified_at: string | null
          pdf_ref: string | null
          signature_ref: string | null
          signed_at: string
          signer_user_id: string
          user_agent: string | null
          verified_phone: string | null
        }
        Insert: {
          agreement_version: string
          campaign_id: string
          content_hash: string
          created_at?: string
          event_id: string
          id?: string
          id_document_ref?: string | null
          ip?: string | null
          otp_verified_at?: string | null
          pdf_ref?: string | null
          signature_ref?: string | null
          signed_at?: string
          signer_user_id: string
          user_agent?: string | null
          verified_phone?: string | null
        }
        Update: {
          agreement_version?: string
          campaign_id?: string
          content_hash?: string
          created_at?: string
          event_id?: string
          id?: string
          id_document_ref?: string | null
          ip?: string | null
          otp_verified_at?: string | null
          pdf_ref?: string | null
          signature_ref?: string | null
          signed_at?: string
          signer_user_id?: string
          user_agent?: string | null
          verified_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signed_agreements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signed_agreements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signed_agreements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "signed_agreements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      sumit_customers: {
        Row: {
          created_at: string
          first_seen_campaign_id: string | null
          sumit_customer_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          first_seen_campaign_id?: string | null
          sumit_customer_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          first_seen_campaign_id?: string | null
          sumit_customer_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sumit_customers_first_seen_campaign_id_fkey"
            columns: ["first_seen_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sumit_customers_first_seen_campaign_id_fkey"
            columns: ["first_seen_campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      support_access_log: {
        Row: {
          accessed_at: string
          event_id: string | null
          id: string
          owner_id: string | null
          permission: string | null
          reason: string | null
          staff_id: string
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          accessed_at?: string
          event_id?: string | null
          id?: string
          owner_id?: string | null
          permission?: string | null
          reason?: string | null
          staff_id: string
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          accessed_at?: string
          event_id?: string | null
          id?: string
          owner_id?: string | null
          permission?: string | null
          reason?: string | null
          staff_id?: string
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_access_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "support_access_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          billing_updates: boolean
          created_at: string
          event_updates: boolean
          reminder_updates: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_updates?: boolean
          created_at?: string
          event_updates?: boolean
          reminder_updates?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_updates?: boolean
          created_at?: string
          event_updates?: boolean
          reminder_updates?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vox_log_exports: {
        Row: {
          attempt_created_at: string | null
          attempts: number
          call_attempt_id: string
          content_sha256: string | null
          content_type: string | null
          created_at: string
          event_id: string | null
          exported_at: string | null
          id: string
          last_error: string | null
          leased_until: string | null
          size_bytes: number | null
          source_url_hash: string | null
          status: string
          storage_path: string | null
          updated_at: string
          vox_call_session_history_id: string | null
        }
        Insert: {
          attempt_created_at?: string | null
          attempts?: number
          call_attempt_id: string
          content_sha256?: string | null
          content_type?: string | null
          created_at?: string
          event_id?: string | null
          exported_at?: string | null
          id?: string
          last_error?: string | null
          leased_until?: string | null
          size_bytes?: number | null
          source_url_hash?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          vox_call_session_history_id?: string | null
        }
        Update: {
          attempt_created_at?: string | null
          attempts?: number
          call_attempt_id?: string
          content_sha256?: string | null
          content_type?: string | null
          created_at?: string
          event_id?: string | null
          exported_at?: string | null
          id?: string
          last_error?: string | null
          leased_until?: string | null
          size_bytes?: number | null
          source_url_hash?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          vox_call_session_history_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vox_log_exports_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: true
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vox_log_exports_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "vox_log_exports_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_inbox: {
        Row: {
          attempts: number
          context_message_id: string | null
          dedupe_key: string
          event_at: string | null
          event_kind: string
          id: string
          last_error: string | null
          message_id: string | null
          payload: Json
          phone_number_id: string | null
          processed_at: string | null
          provider: string
          received_at: string
        }
        Insert: {
          attempts?: number
          context_message_id?: string | null
          dedupe_key: string
          event_at?: string | null
          event_kind: string
          id?: string
          last_error?: string | null
          message_id?: string | null
          payload: Json
          phone_number_id?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Update: {
          attempts?: number
          context_message_id?: string | null
          dedupe_key?: string
          event_at?: string | null
          event_kind?: string
          id?: string
          last_error?: string | null
          message_id?: string | null
          payload?: Json
          phone_number_id?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      console_agents_roster: {
        Row: {
          calendar_busy_until: string | null
          calendar_show_as: string | null
          display_name: string | null
          provisioned: boolean | null
          status: string | null
          status_updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "console_agents_staff_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "platform_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_call_analysis: {
        Row: {
          adults: number | null
          analysis_at: string | null
          call_attempt_id: string | null
          call_duration_secs: number | null
          call_successful: string | null
          children: number | null
          el_eval: Json | null
          event_id: string | null
          rsvp_status: string | null
          score: number | null
          status: string | null
          termination_reason: string | null
        }
        Insert: {
          adults?: never
          analysis_at?: string | null
          call_attempt_id?: string | null
          call_duration_secs?: number | null
          call_successful?: string | null
          children?: never
          el_eval?: Json | null
          event_id?: string | null
          rsvp_status?: never
          score?: never
          status?: string | null
          termination_reason?: string | null
        }
        Update: {
          adults?: never
          analysis_at?: string | null
          call_attempt_id?: string | null
          call_duration_secs?: number | null
          call_successful?: string | null
          children?: never
          el_eval?: Json | null
          event_id?: string | null
          rsvp_status?: never
          score?: never
          status?: string | null
          termination_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_analysis_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_analysis_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_analysis_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      console_campaign_targets: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          current_step_index: number | null
          event_id: string | null
          guest_name: string | null
          id: string | null
          next_run_at: string | null
          phone: string | null
          reached_at: string | null
          reached_channel:
            | Database["public"]["Enums"]["campaign_channel"]
            | null
          status: string | null
          stop_reason: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "console_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_state_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "outreach_state_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      console_campaigns: {
        Row: {
          close_at: string | null
          created_at: string | null
          enabled: boolean | null
          event_id: string | null
          id: string | null
          max_contacts: number | null
          start_at: string | null
          status: Database["public"]["Enums"]["campaign_status"] | null
          updated_at: string | null
        }
        Insert: {
          close_at?: string | null
          created_at?: string | null
          enabled?: never
          event_id?: string | null
          id?: string | null
          max_contacts?: number | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"] | null
          updated_at?: string | null
        }
        Update: {
          close_at?: string | null
          created_at?: string | null
          enabled?: never
          event_id?: string | null
          id?: string | null
          max_contacts?: number | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "campaigns_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      console_event_guests: {
        Row: {
          call_block_reason: string | null
          callback_scheduled_at: string | null
          can_start_outreach_call: boolean | null
          dialable: boolean | null
          event_id: string | null
          guest_id: string | null
          guest_name: string | null
          has_active_campaign: boolean | null
          phone: string | null
          reached_at: string | null
          rsvp_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      console_events: {
        Row: {
          event_date: string | null
          event_id: string | null
          event_name: string | null
          event_type: string | null
          has_campaign: boolean | null
        }
        Insert: {
          event_date?: string | null
          event_id?: string | null
          event_name?: string | null
          event_type?: never
          has_campaign?: never
        }
        Update: {
          event_date?: string | null
          event_id?: string | null
          event_name?: string | null
          event_type?: never
          has_campaign?: never
        }
        Relationships: []
      }
      console_me: {
        Row: {
          display_name: string | null
          permissions: string[] | null
          platform_rank: number | null
          platform_role: string | null
          user_id: string | null
          vox_username: string | null
        }
        Relationships: [
          {
            foreignKeyName: "console_agents_staff_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "platform_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_rsvp_results: {
        Row: {
          adults: number | null
          attending: boolean | null
          created_at: string | null
          event_id: string | null
          guest_id: string | null
          guest_name: string | null
          id: string | null
          kids: number | null
          note: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "console_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "rsvp_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_responses_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "console_event_guests"
            referencedColumns: ["guest_id"]
          },
          {
            foreignKeyName: "rsvp_responses_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_connections_status: {
        Row: {
          id: string | null
          last_verified_at: string | null
          mailbox_email: string | null
          org_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          id?: string | null
          last_verified_at?: string | null
          mailbox_email?: string | null
          org_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string | null
          last_verified_at?: string | null
          mailbox_email?: string | null
          org_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exchange_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
      call_analysis:
        | {
            Args: {
              "": Database["public"]["Tables"]["callback_request_attempts"]["Row"]
            }
            Returns: {
              agent_id: string | null
              agent_turns: number | null
              analysis_at: string | null
              call_attempt_id: string | null
              call_duration_secs: number | null
              call_successful: string | null
              conversation_id: string
              cost_credits: number | null
              cost_fiat: number | null
              el_call_score: number | null
              el_data: Json | null
              el_eval: Json | null
              event_id: string | null
              frustration_score: number | null
              id: string
              linked_at: string | null
              overall_score: number | null
              provider: string
              received_at: string
              rsvp_persisted: boolean | null
              sentiment_label: string | null
              status: string | null
              summary_title: string | null
              termination_reason: string | null
              transcript_summary: string | null
              user_turns: number | null
              voicemail_detected: boolean | null
            }
            SetofOptions: {
              from: "callback_request_attempts"
              to: "call_analysis"
              isOneToOne: true
              isSetofReturn: true
            }
          }
        | {
            Args: {
              "": Database["public"]["Tables"]["sales_call_attempts"]["Row"]
            }
            Returns: {
              agent_id: string | null
              agent_turns: number | null
              analysis_at: string | null
              call_attempt_id: string | null
              call_duration_secs: number | null
              call_successful: string | null
              conversation_id: string
              cost_credits: number | null
              cost_fiat: number | null
              el_call_score: number | null
              el_data: Json | null
              el_eval: Json | null
              event_id: string | null
              frustration_score: number | null
              id: string
              linked_at: string | null
              overall_score: number | null
              provider: string
              received_at: string
              rsvp_persisted: boolean | null
              sentiment_label: string | null
              status: string | null
              summary_title: string | null
              termination_reason: string | null
              transcript_summary: string | null
              user_turns: number | null
              voicemail_detected: boolean | null
            }
            SetofOptions: {
              from: "sales_call_attempts"
              to: "call_analysis"
              isOneToOne: true
              isSetofReturn: true
            }
          }
      campaign_billing_summary: {
        Args: { p_campaign: string }
        Returns: {
          accrued: number
          ceiling: number
          max_contacts: number
          reached_count: number
        }[]
      }
      can_access_event: {
        Args: { _action?: string; _event_id: string; _resource?: string }
        Returns: boolean
      }
      cancel_campaign: { Args: { p_campaign: string }; Returns: string }
      claim_callback_triage: {
        Args: never
        Returns: {
          attempt_count: number
          calendar_item_id: string | null
          call_outcome: string
          consecutive_no_answer_count: number
          created_at: string
          exchange_connection_id: string | null
          excluded_dates: string[] | null
          full_name: string
          id: string
          no_contact_sms_claimed_at: string | null
          no_contact_sms_error: string | null
          no_contact_sms_provider_id: string | null
          no_contact_sms_sent_at: string | null
          not_after_min: number | null
          not_before_min: number | null
          note: string | null
          phone: string
          requested_at: string | null
          requested_rank: string | null
          scheduled_at: string | null
          scheduling_failure_reason: string | null
          status: string
          topic: string | null
          triage: Json | null
          triage_attempt_count: number
          triage_claimed_at: string | null
          triage_last_error: string | null
          triage_status: string
          triaged_at: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "callback_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_first_admin: { Args: never; Returns: boolean }
      claim_thankyou_recipient: {
        Args: { p_campaign: string; p_contact: string; p_event: string }
        Returns: string
      }
      claim_webhook_events: {
        Args: { _limit: number }
        Returns: {
          attempts: number
          context_message_id: string | null
          dedupe_key: string
          event_at: string | null
          event_kind: string
          id: string
          last_error: string | null
          message_id: string | null
          payload: Json
          phone_number_id: string | null
          processed_at: string | null
          provider: string
          received_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_inbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_organization: { Args: { _name: string }; Returns: string }
      exposed_for_billing: {
        Args: {
          p_campaign: string
          p_channel: Database["public"]["Enums"]["campaign_channel"]
          p_contact: string
          p_event: string
        }
        Returns: boolean
      }
      finish_callback_triage: {
        Args: {
          p_at_time?: string
          p_claimed_attempt: number
          p_error?: string
          p_excluded_dates?: string[]
          p_not_after_min?: number
          p_not_before_min?: number
          p_on_date?: string
          p_request_id: string
          p_status: string
          p_triage?: Json
        }
        Returns: string
      }
      fleet_answer_request: {
        Args: { p_answer?: string; p_id: string; p_verdict: string }
        Returns: undefined
      }
      fleet_consume_request: {
        Args: { p_id: string }
        Returns: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          body: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          request_key: string
          role: string
          run_id: string | null
          status: string
          tier: number
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "fleet_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fleet_goal_abandon: {
        Args: { p_id: string; p_note: string }
        Returns: string
      }
      fleet_goal_close: {
        Args: {
          p_id: string
          p_note?: string
          p_status: string
          p_step: number
        }
        Returns: string
      }
      fleet_goal_create: {
        Args: { p_body: string; p_role: string; p_title: string }
        Returns: {
          body: string
          closed_at: string | null
          consecutive_failures: number
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          next_wake_at: string | null
          role: string
          state: Json
          status: string
          step_count: number
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fleet_goals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fleet_goal_pause: {
        Args: { p_id: string; p_note?: string }
        Returns: string
      }
      fleet_goal_progress: {
        Args: {
          p_error?: string
          p_id: string
          p_next_wake_at: string
          p_state: Json
          p_step: number
        }
        Returns: string
      }
      fleet_goal_resume: {
        Args: { p_id: string; p_next_wake_at?: string }
        Returns: string
      }
      fleet_owner_request: {
        Args: {
          p_body: string
          p_kind: string
          p_role: string
          p_thread_root?: string
          p_tier: number
          p_title: string
        }
        Returns: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          body: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          request_key: string
          role: string
          run_id: string | null
          status: string
          tier: number
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "fleet_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_event_attendees_public: { Args: { _token: string }; Returns: Json }
      get_rsvp_by_token: { Args: { _token: string }; Returns: Json }
      guest_effective_attending: {
        Args: { g: Database["public"]["Tables"]["guests"]["Row"] }
        Returns: number
      }
      guest_totals: { Args: { _event_id: string }; Returns: Json }
      has_org_permission: {
        Args: { _action: string; _org_id: string; _resource: string }
        Returns: boolean
      }
      has_platform_permission: { Args: { _key: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_service_exposure: {
        Args: { p_campaign: string; p_contact: string }
        Returns: boolean
      }
      is_console_agent: { Args: never; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_org_owner: { Args: { _org_id: string }; Returns: boolean }
      is_platform_owner: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      next_manual_touchpoint: {
        Args: { p_campaign: string; p_contact: string }
        Returns: number
      }
      ops_db_health: {
        Args: never
        Returns: {
          active_connections: number
          index_hit_rate_pct: number
          longest_query_seconds: number
          max_connections: number
          table_hit_rate_pct: number
          top_queries: Json
        }[]
      }
      ops_job_health: {
        Args: never
        Returns: {
          active_count: number
          cron: string
          failed_count: number
          is_scheduled: boolean
          last_completed_on: string
          oldest_pending_on: string
          queue_name: string
          queued_count: number
          schedule_tz: string
          total_count: number
        }[]
      }
      org_role_rank: { Args: { _role_id: string }; Returns: number }
      over_invited: {
        Args: { g: Database["public"]["Tables"]["guests"]["Row"] }
        Returns: boolean
      }
      owns_event: { Args: { _event_id: string }; Returns: boolean }
      reconcile_authorized_set: {
        Args: {
          p_actor?: string
          p_campaign: string
          p_contact: string
          p_event: string
          p_op: string
          p_prev_contact?: string
        }
        Returns: string
      }
      record_step_plan: {
        Args: {
          p_campaign: string
          p_contact: string
          p_expected_plan_rev: string
          p_expected_planned_at: string
          p_expected_step: number
          p_next_plan_rev: string
          p_next_planned_at: string
        }
        Returns: string
      }
      release_outreach_reservation: {
        Args: {
          p_campaign: string
          p_contact: string
          p_expected_plan_rev: string
          p_job_id: string
          p_step: number
        }
        Returns: string
      }
      reserve_outreach_step: {
        Args: {
          p_campaign: string
          p_contact: string
          p_expected_plan_rev: string
          p_expected_planned_at: string
          p_job_id: string
          p_step: number
        }
        Returns: string
      }
      resolve_outreach_step: {
        Args: {
          p_advance: boolean
          p_audit_id: string
          p_campaign: string
          p_contact: string
          p_event_id: string
          p_expected_plan_rev: string
          p_job_id: string
          p_reason: string
          p_step: number
          p_terminal_status: string
        }
        Returns: string
      }
      submit_rsvp: {
        Args: {
          _adults: number
          _answers?: Json
          _call_consent?: boolean
          _kids: number
          _meal: string
          _note: string
          _show_in_list?: boolean
          _status: string
          _token: string
        }
        Returns: Json
      }
      try_record_billed_result: {
        Args: {
          p_attempt: string
          p_campaign: string
          p_channel: Database["public"]["Enums"]["campaign_channel"]
          p_contact: string
          p_event: string
          p_evidence: string
          p_provider_ref: string
        }
        Returns: string
      }
    }
    Enums: {
      agreement_status: "draft" | "approved"
      app_role: "admin" | "user"
      billing_route: "saved_token" | "hold_j5"
      campaign_channel: "whatsapp" | "call"
      campaign_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "scheduled"
        | "active"
        | "paused"
        | "closed"
        | "awaiting_invoice"
        | "billed"
        | "paid"
        | "cancelled"
      contact_op_status:
        | "pending_contact"
        | "not_eligible"
        | "whatsapp_sent"
        | "whatsapp_delivered"
        | "whatsapp_read"
        | "whatsapp_responded"
        | "pending_call"
        | "call_dialed"
        | "no_answer"
        | "voicemail"
        | "human_interaction_call"
        | "wrong_number"
        | "removal_requested"
        | "reached_billed"
        | "not_reached"
      contact_status:
        | "not_contacted"
        | "contacted"
        | "responded"
        | "wrong_number"
        | "unclear"
        | "unavailable"
        | "callback"
      event_status: "draft" | "active" | "closed"
      event_type:
        | "wedding"
        | "bar_mitzvah"
        | "bat_mitzvah"
        | "brit"
        | "britah"
        | "henna"
        | "engagement"
        | "birthday"
        | "other"
      faq_category: "about" | "pricing" | "how_it_works" | "legal_support"
      guest_status: "pending" | "attending" | "declined" | "maybe"
      order_status: "pending" | "paid"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agreement_status: ["draft", "approved"],
      app_role: ["admin", "user"],
      billing_route: ["saved_token", "hold_j5"],
      campaign_channel: ["whatsapp", "call"],
      campaign_status: [
        "draft",
        "pending_approval",
        "approved",
        "scheduled",
        "active",
        "paused",
        "closed",
        "awaiting_invoice",
        "billed",
        "paid",
        "cancelled",
      ],
      contact_op_status: [
        "pending_contact",
        "not_eligible",
        "whatsapp_sent",
        "whatsapp_delivered",
        "whatsapp_read",
        "whatsapp_responded",
        "pending_call",
        "call_dialed",
        "no_answer",
        "voicemail",
        "human_interaction_call",
        "wrong_number",
        "removal_requested",
        "reached_billed",
        "not_reached",
      ],
      contact_status: [
        "not_contacted",
        "contacted",
        "responded",
        "wrong_number",
        "unclear",
        "unavailable",
        "callback",
      ],
      event_status: ["draft", "active", "closed"],
      event_type: [
        "wedding",
        "bar_mitzvah",
        "bat_mitzvah",
        "brit",
        "britah",
        "henna",
        "engagement",
        "birthday",
        "other",
      ],
      faq_category: ["about", "pricing", "how_it_works", "legal_support"],
      guest_status: ["pending", "attending", "declined", "maybe"],
      order_status: ["pending", "paid"],
    },
  },
} as const
