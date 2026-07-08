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
            referencedRelation: "events"
            referencedColumns: ["id"]
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
          campaign_holds_enabled: boolean
          close_charge_enabled: boolean
          company_contact_email: string | null
          company_contact_phone: string | null
          company_legal_address: string | null
          company_legal_id: string | null
          company_legal_name: string | null
          dkim_domain: string | null
          dkim_private_key: string | null
          dkim_selector: string | null
          email_enabled: boolean
          extra_sms_sender: string | null
          extra_sms_token: string | null
          extreme_threshold_contacts: number
          id: boolean
          outreach_enabled: boolean
          payments_enabled: boolean
          privacy_url: string | null
          reasonable_coverage_contacts: number
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
          campaign_holds_enabled?: boolean
          close_charge_enabled?: boolean
          company_contact_email?: string | null
          company_contact_phone?: string | null
          company_legal_address?: string | null
          company_legal_id?: string | null
          company_legal_name?: string | null
          dkim_domain?: string | null
          dkim_private_key?: string | null
          dkim_selector?: string | null
          email_enabled?: boolean
          extra_sms_sender?: string | null
          extra_sms_token?: string | null
          extreme_threshold_contacts?: number
          id?: boolean
          outreach_enabled?: boolean
          payments_enabled?: boolean
          privacy_url?: string | null
          reasonable_coverage_contacts?: number
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
          campaign_holds_enabled?: boolean
          close_charge_enabled?: boolean
          company_contact_email?: string | null
          company_contact_phone?: string | null
          company_legal_address?: string | null
          company_legal_id?: string | null
          company_legal_name?: string | null
          dkim_domain?: string | null
          dkim_private_key?: string | null
          dkim_selector?: string | null
          email_enabled?: boolean
          extra_sms_sender?: string | null
          extra_sms_token?: string | null
          extreme_threshold_contacts?: number
          id?: boolean
          outreach_enabled?: boolean
          payments_enabled?: boolean
          privacy_url?: string | null
          reasonable_coverage_contacts?: number
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
        }
        Insert: {
          amount: number
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          reason: string
        }
        Update: {
          amount?: number
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          reason?: string
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
            foreignKeyName: "billing_credits_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      callback_requests: {
        Row: {
          created_at: string
          full_name: string
          id: string
          note: string | null
          phone: string
          status: string
          topic: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          note?: string | null
          phone: string
          status?: string
          topic?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          note?: string | null
          phone?: string
          status?: string
          topic?: string | null
          updated_at?: string
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
          enabled: boolean
          event_id: string
          final_charge_amount: number | null
          final_invoice_document_id: number | null
          id: string
          max_charge_ceiling: number | null
          max_contacts: number
          outreach_schedule: Json | null
          price_per_reached: number | null
          release_status: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          steps: Json
          sumit_charge_document_id: number | null
          sumit_order_document_id: number | null
          template_id: string | null
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
          enabled?: boolean
          event_id: string
          final_charge_amount?: number | null
          final_invoice_document_id?: number | null
          id?: string
          max_charge_ceiling?: number | null
          max_contacts: number
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          release_status?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          steps?: Json
          sumit_charge_document_id?: number | null
          sumit_order_document_id?: number | null
          template_id?: string | null
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
          enabled?: boolean
          event_id?: string
          final_charge_amount?: number | null
          final_invoice_document_id?: number | null
          id?: string
          max_charge_ceiling?: number | null
          max_contacts?: number
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          release_status?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          steps?: Json
          sumit_charge_document_id?: number | null
          sumit_order_document_id?: number | null
          template_id?: string | null
          tos_version?: string | null
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "events"
            referencedColumns: ["id"]
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
          created_at: string
          email: string | null
          id: string
          message: string
          name: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          name: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
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
      message_templates: {
        Row: {
          active: boolean
          body: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          components: Json | null
          created_at: string
          id: string
          label: string | null
          language: string
          message_key: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string | null
          channel: Database["public"]["Enums"]["campaign_channel"]
          components?: Json | null
          created_at?: string
          id?: string
          label?: string | null
          language?: string
          message_key: string
          name?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string | null
          channel?: Database["public"]["Enums"]["campaign_channel"]
          components?: Json | null
          created_at?: string
          id?: string
          label?: string | null
          language?: string
          message_key?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          authorization_accepted: boolean
          created_at: string
          event_id: string | null
          id: string
          package_id: string | null
          paid_at: string | null
          payment_attempt_ref: string
          payment_processing_started_at: string | null
          privacy_accepted: boolean
          status: Database["public"]["Enums"]["order_status"]
          sumit_document_id: number | null
          terms_accepted: boolean
          total_with_vat: number
          user_id: string
          vat_rate: number
          with_ai_addon: boolean
        }
        Insert: {
          authorization_accepted?: boolean
          created_at?: string
          event_id?: string | null
          id?: string
          package_id?: string | null
          paid_at?: string | null
          payment_attempt_ref?: string
          payment_processing_started_at?: string | null
          privacy_accepted?: boolean
          status?: Database["public"]["Enums"]["order_status"]
          sumit_document_id?: number | null
          terms_accepted?: boolean
          total_with_vat: number
          user_id: string
          vat_rate?: number
          with_ai_addon?: boolean
        }
        Update: {
          authorization_accepted?: boolean
          created_at?: string
          event_id?: string | null
          id?: string
          package_id?: string | null
          paid_at?: string | null
          payment_attempt_ref?: string
          payment_processing_started_at?: string | null
          privacy_accepted?: boolean
          status?: Database["public"]["Enums"]["order_status"]
          sumit_document_id?: number | null
          terms_accepted?: boolean
          total_with_vat?: number
          user_id?: string
          vat_rate?: number
          with_ai_addon?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
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
        ]
      }
      packages: {
        Row: {
          active: boolean
          category: string
          channels: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at: string
          description: string | null
          hold_buffer_pct: number
          id: string
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
          category?: string
          channels?: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at?: string
          description?: string | null
          hold_buffer_pct?: number
          id?: string
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
          category?: string
          channels?: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at?: string
          description?: string | null
          hold_buffer_pct?: number
          id?: string
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
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          label: string
          resource: string
          sort_order?: number
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          label?: string
          resource?: string
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
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
            referencedRelation: "events"
            referencedColumns: ["id"]
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
            foreignKeyName: "signed_agreements_event_id_fkey"
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
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
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
      claim_first_admin: { Args: never; Returns: boolean }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      org_role_rank: { Args: { _role_id: string }; Returns: number }
      over_invited: {
        Args: { g: Database["public"]["Tables"]["guests"]["Row"] }
        Returns: boolean
      }
      owns_event: { Args: { _event_id: string }; Returns: boolean }
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
          _kids: number
          _meal: string
          _note: string
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
      guest_status: "pending" | "attending" | "declined" | "maybe"
      order_status:
        | "pending"
        | "paid"
        | "failed"
        | "demo"
        | "processing"
        | "payment_review"
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
      guest_status: ["pending", "attending", "declined", "maybe"],
      order_status: [
        "pending",
        "paid",
        "failed",
        "demo",
        "processing",
        "payment_review",
      ],
    },
  },
} as const
