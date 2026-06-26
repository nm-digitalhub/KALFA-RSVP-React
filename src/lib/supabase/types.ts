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
      app_settings: {
        Row: {
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
          id: boolean
          payments_enabled: boolean
          privacy_url: string | null
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
        }
        Insert: {
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
          id?: boolean
          payments_enabled?: boolean
          privacy_url?: string | null
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
        }
        Update: {
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
          id?: boolean
          payments_enabled?: boolean
          privacy_url?: string | null
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
      campaigns: {
        Row: {
          allowed_channels: Database["public"]["Enums"]["campaign_channel"][]
          approved_at: string | null
          approved_by: string | null
          auth_amount: number | null
          auth_expires_at: string | null
          auth_number: string | null
          authorized_at: string | null
          billing_route: Database["public"]["Enums"]["billing_route"] | null
          capture_status: string | null
          card_token_ref: string | null
          close_at: string | null
          created_at: string
          enabled: boolean
          event_id: string
          final_charge_amount: number | null
          final_invoice_document_id: number | null
          id: string
          max_charge_ceiling: number | null
          max_contacts: number | null
          outreach_schedule: Json | null
          price_per_reached: number | null
          release_status: string | null
          start_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          steps: Json
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
          auth_number?: string | null
          authorized_at?: string | null
          billing_route?: Database["public"]["Enums"]["billing_route"] | null
          capture_status?: string | null
          card_token_ref?: string | null
          close_at?: string | null
          created_at?: string
          enabled?: boolean
          event_id: string
          final_charge_amount?: number | null
          final_invoice_document_id?: number | null
          id?: string
          max_charge_ceiling?: number | null
          max_contacts?: number | null
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          release_status?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          steps?: Json
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
          auth_number?: string | null
          authorized_at?: string | null
          billing_route?: Database["public"]["Enums"]["billing_route"] | null
          capture_status?: string | null
          card_token_ref?: string | null
          close_at?: string | null
          created_at?: string
          enabled?: boolean
          event_id?: string
          final_charge_amount?: number | null
          final_invoice_document_id?: number | null
          id?: string
          max_charge_ceiling?: number | null
          max_contacts?: number | null
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          release_status?: string | null
          start_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          steps?: Json
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
          created_at: string
          direction: string
          event_id: string | null
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
          created_at?: string
          direction: string
          event_id?: string | null
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
          created_at?: string
          direction?: string
          event_id?: string | null
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
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          normalized_phone: string
          op_status?: Database["public"]["Enums"]["contact_op_status"]
          removal_requested?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          normalized_phone?: string
          op_status?: Database["public"]["Enums"]["contact_op_status"]
          removal_requested?: boolean
          updated_at?: string
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
          created_at: string
          event_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          name: string
          notes: string | null
          owner_id: string
          package_id: string | null
          rsvp_deadline: string | null
          status: Database["public"]["Enums"]["event_status"]
          template: string | null
          updated_at: string
          venue_address: string | null
          venue_name: string | null
          with_ai_calls: boolean
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          name: string
          notes?: string | null
          owner_id: string
          package_id?: string | null
          rsvp_deadline?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          template?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
          with_ai_calls?: boolean
        }
        Update: {
          created_at?: string
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          package_id?: string | null
          rsvp_deadline?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          template?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
          with_ai_calls?: boolean
        }
        Relationships: [
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
      guests: {
        Row: {
          callback_requested: boolean
          confirmed_adults: number | null
          confirmed_kids: number | null
          contact_id: string | null
          contact_status: Database["public"]["Enums"]["contact_status"]
          created_at: string
          event_id: string
          expected_count: number | null
          extras: Json
          full_name: string
          group_id: string | null
          id: string
          language: string | null
          meal_pref: string | null
          note: string | null
          phone: string | null
          rsvp_token: string
          status: Database["public"]["Enums"]["guest_status"]
          updated_at: string
        }
        Insert: {
          callback_requested?: boolean
          confirmed_adults?: number | null
          confirmed_kids?: number | null
          contact_id?: string | null
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          event_id: string
          expected_count?: number | null
          extras?: Json
          full_name: string
          group_id?: string | null
          id?: string
          language?: string | null
          meal_pref?: string | null
          note?: string | null
          phone?: string | null
          rsvp_token?: string
          status?: Database["public"]["Enums"]["guest_status"]
          updated_at?: string
        }
        Update: {
          callback_requested?: boolean
          confirmed_adults?: number | null
          confirmed_kids?: number | null
          contact_id?: string | null
          contact_status?: Database["public"]["Enums"]["contact_status"]
          created_at?: string
          event_id?: string
          expected_count?: number | null
          extras?: Json
          full_name?: string
          group_id?: string | null
          id?: string
          language?: string | null
          meal_pref?: string | null
          note?: string | null
          phone?: string | null
          rsvp_token?: string
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
      packages: {
        Row: {
          active: boolean
          category: string
          channels: Database["public"]["Enums"]["campaign_channel"][] | null
          created_at: string
          description: string | null
          id: string
          includes: Json
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
          id?: string
          includes?: Json
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
          id?: string
          includes?: Json
          name?: string
          outreach_schedule?: Json | null
          price_per_reached?: number | null
          price_with_vat?: number
          sort_order?: number
          tier?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_first_admin: { Args: never; Returns: boolean }
      get_rsvp_by_token: { Args: { _token: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      owns_event: { Args: { _event_id: string }; Returns: boolean }
      submit_rsvp: {
        Args: {
          _adults: number
          _attending: boolean
          _kids: number
          _meal: string
          _note: string
          _token: string
        }
        Returns: boolean
      }
    }
    Enums: {
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
