

# agent-configuration.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/agent-configuration.md

# Agent Configuration

Complete reference for configuring conversational AI agents.

## Configuration Structure

```python
agent = client.conversational_ai.agents.create(
    name="My Agent",
    conversation_config={
        "agent": {
            "first_message": "Hello!",
            "language": "en",
            "prompt": {           # LLM, system prompt, tools, and knowledge base
                "prompt": "You are helpful.",
                "llm": "gemini-2.0-flash",
                "tools": [...],
                "built_in_tools": {...}
            }
        },
        "tts": {...},             # Voice and TTS model settings
        "asr": {...},             # Speech recognition settings
        "turn": {...},            # Turn-taking behavior
        "conversation": {...},    # Duration, events, monitoring
        "vad": {...},             # Voice activity detection config
        "language_presets": {...}  # Language-specific overrides
    },
    platform_settings={...}       # Auth, call limits
)
```

## conversation_config

Controls the real-time conversation behavior.

### agent

```python
conversation_config={
    "agent": {
        "first_message": "Hello! How can I help you today?",
        "language": "en",
        "disable_first_message_interruptions": False,
        "prompt": {
            "prompt": "You are a helpful assistant.",
            "llm": "gemini-2.0-flash",
            "temperature": 0.7
        }
    }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `first_message` | string | `""` | What the agent says when conversation starts |
| `language` | string | `"en"` | ISO 639-1 language code (en, es, fr, etc.) |
| `disable_first_message_interruptions` | bool | `false` | Prevent user from interrupting the first message |
| `max_conversation_duration_message` | string | - | If non-empty, the message sent when `conversation.max_duration_seconds` is reached |
| `text_behavior_overrides` | object | - | Per-channel text behavior overrides. Map of `ConversationInitiationSource` -> `BehaviorOverride` (`verbosity`, `output_format`, `interaction_budget`). Interaction budgets are `realtime`, `5_minutes`, `10_minutes`, or `1_hour`. See [API reference](https://elevenlabs.io/docs/api-reference/agents/create#request.body.conversation_config.agent.text_behavior_overrides). |
| `hinglish_mode` | bool | `false` | When enabled and language is Hindi, agent responds in Hinglish |
| `dynamic_variables` | object | - | Config with `dynamic_variable_placeholders` containing key-value pairs |
| `prompt` | object | - | LLM configuration (see prompt section below) |

### tts (Text-to-Speech)

```python
conversation_config={
    "tts": {
        "voice_id": "JBFqnCBsd6RMkjVDRZzb",
        "model_id": "eleven_v4_turbo",
        "stability": 0.5,
        "similarity_boost": 0.8
    }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `voice_id` | string | `"cjVigY5qzO86Huf0OWal"` | Voice to use |
| `model_id` | string | `"eleven_v4_turbo"` | TTS model (see below) |
| `stability` | float | `0.5` | 0-1, lower = more expressive |
| `similarity_boost` | float | `0.8` | 0-1, higher = closer to original voice |
| `speed` | float | `1.0` | 0.7-1.2, speech speed multiplier (not supported on Eleven v4 models) |
| `expressive_mode` | bool | `true` | Enable expressive voice generation |
| `agent_output_audio_format` | string | - | Output audio codec format |
| `pronunciation_dictionary_locators` | array | - | Pronunciation overrides |
| `enable_phoneme_tags` | bool | `true` | Parse inline and pronunciation-dictionary SSML phoneme tags into IPA for V3 models |

**Available TTS models for agents:**

| Model ID | Languages | Latency |
|----------|-----------|---------|
| `eleven_v4_turbo` | 90+ | ~100ms (default, recommended — most expressive real-time model) |
| `eleven_v4` | 90+ | Standard |
| `eleven_flash_v2_5` | 32 | ~75ms (lowest latency and cost) |
| `eleven_flash_v2` | English | ~75ms |
| `eleven_v3_conversational` | 70+ | ~280ms (previous generation) |
| `eleven_multilingual_v2` | 29 | Standard (previous generation) |

`eleven_turbo_v2_5` and `eleven_turbo_v2` are still accepted but superseded by the Flash models. Eleven v4 models use only `stability` and `similarity_boost`; `speed` does not apply.

### asr (Automatic Speech Recognition)

```python
conversation_config={
    "asr": {
        "quality": "high",
        "provider": "scribe_realtime",
        "keywords": ["ElevenLabs", "TechCorp"],
        "user_input_audio_format": "pcm_16000"
    }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `quality` | string | `"high"` | Transcription quality level |
| `provider` | string | `"scribe_realtime"` | ASR provider for current agents |
| `keywords` | array | - | Words to boost recognition accuracy |
| `user_input_audio_format` | string | - | Input audio format (e.g., `pcm_16000`, `ulaw_8000`) |

### turn (Turn-Taking)

```python
conversation_config={
    "turn": {
        "turn_timeout": 7,
        "turn_eagerness": "normal",
        "silence_end_call_timeout": -1,
        "turn_model": "turn_v3"
    }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `turn_timeout` | number | `7` | Seconds to wait before re-engaging the user |
| `turn_eagerness` | string | `"normal"` | How quickly agent responds: `patient`, `normal`, or `eager` |
| `silence_end_call_timeout` | number | `-1` | Seconds of silence before ending call (-1 = disabled) |
| `initial_wait_time` | number | - | Seconds to wait for user to start speaking |
| `spelling_patience` | string | `"auto"` | Entity detection patience: `auto` or `off` |
| `speculative_turn` | bool | `false` | Enable speculative turn detection |
| `turn_model` | string | `"turn_v3"` | Turn detection model version: `turn_v2` or `turn_v3` |
| `interruption_ignore_terms` | array | - | Case-insensitive terms that should not trigger an interruption when spoken by the user |
| `interruption_ignore_term_languages` | array | - | Language codes whose curated ignore-term lists are enabled |
| `merge_with_default_ignore_terms` | bool | `false` | Combine curated terms for `interruption_ignore_term_languages` with `interruption_ignore_terms` |
| `transcribe_on_disabled_interruptions` | bool | `false` | When interruptions are disabled, still transcribe user speech so it can carry into the next turn |
| `soft_timeout_config` | object | - | Configures a message if user is silent (see below) |

**soft_timeout_config:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout_seconds` | number | `-1` | Seconds before soft timeout (-1 = disabled) |
| `message` | string | `"Hhmmmm...yeah."` | What agent says on timeout; supports dynamic variables |
| `additional_soft_timeout_messages` | array | - | Extra static filler messages for later timeouts in the same LLM response, up to 7 strings |
| `use_llm_generated_message` | bool | `false` | Let LLM generate the timeout message |
| `randomize_fillers` | bool | `false` | Shuffle static soft timeout messages once at the start of each turn |
| `max_soft_timeouts_per_generation` | int | `1` | Maximum filler messages while waiting for one LLM response (1-8) |
| `llm_generated_message_prompt_override` | string | - | Custom prompt for LLM-generated filler messages; supports dynamic variables |
| `disable_until_first_user_message` | bool | `false` | Suppress soft timeout fillers until the conversation receives its first user message |

## prompt (nested in conversation_config.agent)

Configures the LLM behavior. This object lives at `conversation_config.agent.prompt`:

```python
conversation_config={
    "agent": {
        "prompt": {
            "prompt": "You are a helpful customer service agent...",
            "llm": "gemini-2.0-flash",
            "temperature": 0.7,
            "max_tokens": 500,
            "tools": [...],
            "built_in_tools": {...},
            "knowledge_base": [...]
        }
    }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | string | `""` | System prompt defining agent behavior |
| `llm` | string | - | Model ID (see LLM providers below) |
| `temperature` | float | `0` | 0-1, higher = more creative |
| `max_tokens` | int | `-1` | Max tokens for LLM response (-1 = unlimited) |
| `reasoning_effort` | string | - | Reasoning depth: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` (model-dependent) |
| `thinking_budget` | int | - | Max thinking tokens for reasoning models |
| `enable_reasoning_summary` | bool | `false` | Request provider reasoning summaries when supported; keep disabled for lower time-to-first-byte |
| `tools` | array | - | Webhook and client tool definitions |
| `built_in_tools` | object | - | System tools (end_call, transfer, etc.) |
| `enable_parallel_tool_calls` | bool | `true` | Allow supported models to execute multiple tools within one turn |
| `tool_ids` | array | - | References to pre-configured tools |
| `knowledge_base` | array | - | Documents for RAG |
| `custom_llm` | object | - | Custom LLM endpoint config |
| `timezone` | string | - | IANA timezone (e.g., `America/New_York`) |
| `backup_llm_config` | object | - | Fallback LLM configuration |
| `cascade_timeout_seconds` | number | `4` | Seconds before cascading to backup LLM (2-15) |
| `mcp_server_ids` | array | - | MCP server IDs to connect |
| `native_mcp_server_ids` | array | - | Native MCP server IDs |
| `ignore_default_personality` | bool | - | Skip default personality instructions |

Workspace environment variables let one agent configuration span multiple deployments. Use
`{{system_env__label}}` in server tool and MCP server URLs, `{ "env_var_label": "orders_api_key" }`
for secret-backed tool headers, and `{ "env_var_label": "orders_oauth" }` in `auth_connection`
to resolve per-environment auth connections at runtime.

### LLM Providers

| Provider | Model IDs |
|----------|-----------|
| OpenAI | `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.5-2026-04-23`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.4-2026-03-05`, `gpt-5.4-mini-2026-03-17`, `gpt-5.4-nano-2026-03-17`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo` |
| Anthropic | `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-sonnet-4`, `claude-haiku-4-5`, `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-haiku` |
| Google | `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite-preview`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-2.0-flash-lite` |
| ElevenLabs | `glm-52`, `deepseek-v41-flash`, `glm-45-air-fp8`, `qwen3-30b-a3b`, `qwen36-35b-a3b`, `qwen35-35b-a3b`, `qwen35-397b-a17b`, `gpt-oss-120b` (hosted, ultra-low latency) |
| Custom | `custom-llm` (requires custom_llm config) |

Use `GET /v1/convai/llm/list` to inspect the current model catalog, including deprecation state, token/context limits, and capability flags such as image-input support.

### Custom LLM

The `custom_llm` field is nested inside `conversation_config.agent.prompt`:

```python
conversation_config={
    "agent": {
        "prompt": {
            "prompt": "You are helpful.",
            "llm": "custom-llm",
            "custom_llm": {
                "url": "https://your-llm-endpoint.com/v1/chat/completions",
                "model_id": "your-model-id",
                "api_key": {"secret_id": "your-secret-id"},
                "api_type": "chat_completions"  # "chat_completions", "responses", or "websocket"
            }
        }
    }
}
```

## platform_settings

Platform-level configuration for security, limits, summaries, and widget behavior.

```python
platform_settings={
    "summary_language": "en",
    "widget": {
        "show_agent_status": True,
        "show_conversation_id": True
    },
    "auth": {
        "enable_auth": True,
        "allowlist": [{"hostname": "example.com"}]
    },
    "call_limits": {
        "agent_concurrency_limit": 10,
        "daily_limit": 100
    },
    "queueing_config": {
        "enabled": True,
        "wait_timeout_seconds": 300
    },
    "trust_context": "low"
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `summary_language` | string | Language for conversation analysis outputs such as summaries, titles, evaluation rationales, and data collection rationales. If omitted, ElevenLabs infers it from the conversation. |
| `auto_translate_transcript_to_app_language` | bool | Automatically translate a transcript to the viewer's application language when they open it |
| `analysis_items` | object or null | Evaluation criteria and data-collection items attached to the agent by reference |
| `widget` | object | Hosted widget and shareable page configuration. See the widget table below for selected options. |
| `auth` | object | Authentication and origin restrictions for agent access |
| `call_limits` | object | Concurrency and daily usage limits |
| `queueing_config` | object | Per-agent wait queue for calls that arrive at the concurrency limit |
| `guardrails` | object | Built-in safety and policy controls for agent interactions |
| `privacy` | object | Recording, retention, and conversation history redaction settings |
| `trust_context` | string | Trust classification for the agent: `unknown`, `low`, or `high` |
| `topic_discovery` | object | Per-agent topic discovery configuration |
| `sentiment_analysis` | object | Per-agent post-call sentiment analysis configuration |
| `alerting` | object or null | Per-agent monitor thresholds, auto-resolution timing, and webhook, PagerDuty, or Slack notification settings |

### auth

| Field | Type | Description |
|-------|------|-------------|
| `enable_auth` | bool | Require signed URLs/tokens for connections |
| `allowlist` | array | Allowed origins for CORS |
| `shareable_token` | string | Public conversation token |

### call_limits

| Field | Type | Description |
|-------|------|-------------|
| `agent_concurrency_limit` | int | Max simultaneous conversations (default: -1, unlimited) |
| `daily_limit` | int | Max conversations per day (default: 100000) |
| `bursting_enabled` | bool | Allow exceeding limits at 2x cost (default: true) |

### alerting

Use `platform_settings.alerting.notifiers` to deliver alert lifecycle notifications:

| Notifier | Required fields |
|----------|-----------------|
| Webhook | `type: "webhook"`, `webhook_id` |
| PagerDuty | `type: "integration"`, `integration_type: "pagerduty"`, `connection_id` |
| Slack | `type: "integration"`, `integration_type: "slack"`, `connection_id`, `channel_id` |

For Slack, `connection_id` identifies a workspace integration connection with monitoring
capability. `channel_id` identifies the destination channel:

```json
{
  "platform_settings": {
    "alerting": {
      "notifiers": [
        {
          "type": "integration",
          "integration_type": "slack",
          "connection_id": "connection_id",
          "channel_id": "C0123456789"
        }
      ]
    }
  }
}
```
### queueing_config

Call queueing holds callers when the agent is at its concurrency limit and connects them when
capacity becomes available. It is disabled by default.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Hold callers in a queue instead of rejecting them immediately |
| `wait_timeout_seconds` | int | `180` | Maximum wait before disconnection, from 1 to 1,800 seconds |

Queued callers hear the default hold tone unless a custom MP3 or WAV file is uploaded. Use
`client.conversational_ai.agents.hold_audio.create` or
`client.conversationalAi.agents.holdAudio.create` to upload a file, and the corresponding
`delete` method to restore the default tone. The uploaded `hold_audio` object in
`queueing_config` is read-only.

### guardrails

Use `platform_settings.guardrails` to configure built-in safety controls for user input and agent behavior. The fields below cover the current schema additions that are most relevant in agent configs.

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Guardrail config version. Use `"1"` for the current schema. |
| `focus` | object | Keeps the agent on-topic and aligned with the configured task. |
| `prompt_injection` | object | Detects prompt injection and instruction override attempts. |
| `custom` | object | Configures user-defined response validation guardrails. |
| `content` | object | Configures category-specific content moderation guardrails. |

**custom.config.configs[]:**

| Field | Type | Description |
|-------|------|-------------|
| `is_enabled` | bool | Enables the custom guardrail. |
| `name` | string | User-facing guardrail name. |
| `prompt` | string | Instruction describing what to block. |
| `execution_mode` | string | Guardrail execution mode: `streaming` or `blocking`. |
| `model` | string | LLM model used for custom guardrail evaluation, such as `gemini-2.5-flash-lite`, `claude-sonnet-4-6`, or `gpt-5.4-mini`. |
| `history_message_count` | integer | Number of recent customer messages to include in guardrail history; `0` includes none. |
| `trigger_action` | object | Action when triggered, such as retrying with feedback or ending the call. |
| `evaluate_full_response_only` | bool | Evaluate the complete non-TTS response once. Requires `execution_mode` set to `blocking`; defaults to `false`. |

**focus / prompt_injection:**

| Field | Type | Description |
|-------|------|-------------|
| `is_enabled` | bool | Enables the guardrail. |

**content:**

| Field | Type | Description |
|-------|------|-------------|
| `execution_mode` | string | Guardrail execution mode: `streaming` or `blocking`. |
| `config` | object | Category threshold settings for content moderation. |

**content.config:**

| Field | Type | Description |
|-------|------|-------------|
| `sexual` | object | Threshold settings for sexual content. |
| `violence` | object | Threshold settings for violent content. |
| `harassment` | object | Threshold settings for harassment. |
| `self_harm` | object | Threshold settings for self-harm content. |
| `profanity` | object | Threshold settings for profanity. |
| `religion_or_politics` | object | Threshold settings for religion or politics content. |
| `medical_and_legal_information` | object | Threshold settings for medical or legal information. |

**content.config.\<category\>:**

| Field | Type | Description |
|-------|------|-------------|
| `is_enabled` | bool | Enables moderation for the category. |
| `threshold` | number or string | Category threshold as a numeric score or one of `low`, `medium`, or `high`. |

Blocking content guardrails and custom guardrails support a `trigger_action` that either ends
the session immediately or retries the response. Retry removes the blocked reply, injects your
feedback as a system message, and re-generates up to 3 times before the platform falls back to
ending the session. Feedback templates can use `{{trigger_reason}}` and `{{agent_message}}`.

### privacy

Use `platform_settings.privacy` to control recording, retention, and redaction behavior. The redaction-specific field is:

| Field | Type | Description |
|-------|------|-------------|
| `conversation_history_redaction` | object | Redacts configured entity types from stored transcripts, audio, and analysis. |

**conversation_history_redaction:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Whether conversation history redaction is enabled |
| `entities` | array | - | Entity types to redact. Use parent types such as `name` or specific values such as `name.name_given`, `email_address`, `contact_number`, `dob`, and `age`. |

### widget

Use `platform_settings.widget` to configure the hosted widget and shareable page defaults. For client-side embed attributes, see the widget embedding reference.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dismissible` | bool | `false` | Whether the widget can be dismissed by the user |
| `show_agent_status` | bool | `false` | Whether to show working, done, or error status while tools are running |
| `show_conversation_id` | bool | `true` | Whether to show the conversation ID after disconnection |
| `strip_audio_tags` | bool | `true` | Whether to strip audio markup from messages |
| `mic_muting_enabled` | bool | `true` | Whether users can mute their microphone |
| `transcript_enabled` | bool | `true` | Whether to show the live conversation transcript |
| `syntax_highlight_theme` | string | auto | Code block syntax highlighting theme (`light` or `dark`); omit it to let the widget auto-detect |
| `show_resize_button` | bool | `true` | Whether to show the expand and collapse control in the widget header |

### conversation (inside conversation_config)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_duration_seconds` | int | `600` | Max conversation duration |
| `text_only` | bool | `false` | Text-only mode (avoids audio pricing) |
| `file_input` | object | - | Enables image and PDF uploads in chat for multimodal LLMs |
| `dtmf_input_settings` | object or null | - | Collects phone keypad input; set to `null` to disable |
| `monitoring_enabled` | bool | `false` | Enable real-time WebSocket monitoring |
| `client_events` | array | - | Client events forwarded to the connected application |
| `monitoring_events` | array | - | Events forwarded to monitoring WebSocket connections |
| `background_sound` | object | - | Background sound played during conversations |
| `source_attribution` | bool | `false` | Instructs the LLM to report sources used when knowledge base content is present |

Common client events include `agent_response_correction`, `agent_tool_response_full_payload`,
`agent_response_complete`, and `context_usage`. `agent_response_complete` fires when the agent is
done responding. `context_usage` fires after each completed agent turn with `event_id`, `model`,
`context_tokens`, and `context_limit_tokens`. Enable either event by adding it to `client_events`.

**file_input:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Allows end users to attach images or PDFs in chat when the selected LLM supports multimodal input |
| `max_files_in_memory` | int | `10` | Number of most-recent files kept in memory (1-30); older files are summarized and released |
| `max_files_per_conversation` | int | `10` | Total upload limit; use `-1` for no limit or a value at least as large as `max_files_in_memory` |

**dtmf_input_settings:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dtmf_input_timeout` | number | `2` | Seconds to wait after the last keypress before completing the sequence (0.5-10) |
| `hash_terminator` | bool | `true` | Completes the sequence when the caller presses `#` |
| `redact_input` | bool | `false` | Replaces keypad entries in stored transcripts, logs, and analysis; the live agent and tools still receive the digits |

DTMF input accepts out-of-band keypad events during phone calls. Each completed sequence becomes
one user turn.

**background_sound:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source_type` | string | - | Background sound source type; use `preset` for built-in sounds |
| `source_id` | string | - | Preset sound ID, such as `office1`, `office2`, `restaurant`, `city`, `typing`, or `elevator1`-`elevator4` |
| `volume` | number | `0.15` | Playback volume from `0.01` to `1.0` |
| `crossfade_loop` | bool | `true` | Crossfade loop boundaries to avoid audible pops |

## Additional Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `tags` | array | Classification labels for filtering (e.g., `["production"]`, `["test"]`) |
| `workflow` | object | Conversation flow definition and tool interaction sequences |

## Knowledge Base / RAG

Knowledge base is configured inside `conversation_config.agent.prompt`:

```python
agent = client.conversational_ai.agents.create(
    name="Support Agent",
    conversation_config={
        "agent": {
            "prompt": {
                "prompt": "You are a support agent. Use the knowledge base to answer questions.",
                "llm": "gemini-2.0-flash",
                "knowledge_base": [
                    {"type": "file", "id": "doc-id", "name": "Product Guide", "usage_mode": "auto"}
                ],
                "rag": {
                    "enabled": True,
                    "embedding_model": "qwen3_embedding_4b",
                    "max_documents_length": 50000,
                    "max_retrieved_rag_chunks_count": 20
                }
            }
        },
        "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb"}
    }
)
```

`rag.embedding_model` supports `e5_mistral_7b_instruct`, `multilingual_e5_large_instruct`, and `qwen3_embedding_4b`.

Set `conversation_config.conversation.source_attribution` to `true` when you want the agent to
report which knowledge base sources it used in responses.

### Knowledge Base Management

Use a [crawl job](https://elevenlabs.io/docs/api-reference/knowledge-base/create-crawl-job) to
ingest a website into the knowledge base. A crawl requires a `url` and can control crawl depth,
page count, URL matching, sitemaps, folder placement, and automatic synchronization. List,
inspect, or cancel crawl jobs while ingestion is running. Set `auto_discover: true` with
`enable_auto_sync: true` to follow links from crawled pages and add newly discovered pages during
automatic synchronization.

Before deleting several documents or folders, use the
[bulk dependency check](https://elevenlabs.io/docs/api-reference/knowledge-base/dependent-agents-multiple)
to find affected agents. The
[bulk delete endpoint](https://elevenlabs.io/docs/api-reference/knowledge-base/bulk-delete)
returns an independent result for each document ID. Use `force` only when you intend to remove
agent dependencies and recursively delete the contents of non-empty folders.

## CRUD Operations

### Using CLI (Recommended)

```bash
# Initialize project
elevenlabs agents init

# Create agent from template
elevenlabs agents add "My Agent" --template complete
elevenlabs agents add "Support Bot" --template customer-service

# List agents
elevenlabs agents list

# Check status
elevenlabs agents status

# Push local changes to platform
elevenlabs agents push
elevenlabs agents push --dry-run    # Preview changes first

# Import agents from platform
elevenlabs agents pull                      # Import all
elevenlabs agents pull --agent <agent-id>   # Import specific agent
elevenlabs agents pull --update             # Override local configs

# View available templates
elevenlabs agents templates list
elevenlabs agents templates show <template-name>

# Add tools
elevenlabs tools add-webhook "API Tool"
elevenlabs tools add-client "UI Tool"

# Generate widget code
elevenlabs agents widget <agent-id>
```

### SDK: List Agents

```python
agents = client.conversational_ai.agents.list()
for agent in agents.agents:
    print(f"{agent.name}: {agent.agent_id}")
```

```javascript
const agents = await client.conversationalAi.agents.list();
```

```bash
elevenlabs agents list
```

### SDK: Manage Conversation Tags

Use tags to categorize conversation history and filter list views:

```python
tag = client.conversational_ai.conversations.tags.create(
    title="Urgent Support",
    description="Conversations that need same-day follow-up",
)

client.conversational_ai.conversations.tags.assign(
    conversation_id="conversation_id",
    tag_ids=[tag.tag_id],
)

conversations = client.conversational_ai.conversations.list(
    tag_ids=[tag.tag_id],
    exclude_statuses=["initiated", "in-progress", "processing"],
)
```

```javascript
const tag = await client.conversationalAi.conversations.tags.create({
  title: "Urgent Support",
  description: "Conversations that need same-day follow-up",
});

await client.conversationalAi.conversations.tags.assign("conversation_id", {
  tagIds: [tag.tagId],
});

const conversations = await client.conversationalAi.conversations.list({
  tagIds: [tag.tagId],
  excludeStatuses: ["initiated", "in-progress", "processing"],
});
```

Conversation listing and message search can filter by `visited_agent_ids` and
`visited_agent_branch_ids`, `triggered_procedure_ids`, and `include_invalid_tool_calls`. List
conversations also accepts `parent_conversation_id`, `guardrail_types`, `custom_guardrail_names`,
and `sort_direction` to narrow or order results. For a listing that includes selected analysis
results, pass `data_collection_ids` or `evaluation_criteria_ids`; matching summaries include
`data_collection_results` or `evaluation_criteria_results`.

Both operations accept repeatable `data_collection_params`, `dynamic_variable_params`, and
`evaluation_params` filters. Data collection and dynamic variable filters use `name:op:value`,
where `op` is `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, or `in`; comparison operators require a
numeric value, and `in` values use a pipe delimiter. Evaluation filters use
`criteria_id:result`, where `result` is `success`, `failure`, or `unknown`.

### SDK: Get Agent

```python
agent = client.conversational_ai.agents.get(agent_id="your-agent-id")
```

```javascript
const agent = await client.conversationalAi.agents.get("your-agent-id");
```

```bash
elevenlabs agents get --agent-id "your-agent-id"
```

### SDK: Update Agent

Only include fields you want to change. All other settings remain unchanged.

**Python:**
```python
# Update name
client.conversational_ai.agents.update(agent_id="id", name="New Name")

# Update TTS voice
client.conversational_ai.agents.update(agent_id="id", conversation_config={
    "tts": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "model_id": "eleven_v4_turbo"}
})

# Update prompt/LLM (nested in agent)
client.conversational_ai.agents.update(agent_id="id", conversation_config={
    "agent": {"prompt": {"prompt": "New instructions.", "llm": "claude-sonnet-4", "temperature": 0.8}}
})

# Update first message
client.conversational_ai.agents.update(agent_id="id", conversation_config={
    "agent": {"first_message": "Welcome back!"}
})

# Update platform settings
client.conversational_ai.agents.update(agent_id="id", platform_settings={
    "auth": {"enable_auth": True, "allowlist": [{"hostname": "myapp.com"}]}
})
```

**JavaScript:**
```javascript
await client.conversationalAi.agents.update("id", { name: "New Name" });
await client.conversationalAi.agents.update("id", {
  conversationConfig: { tts: { voiceId: "EXAVITQu4vr4xnSDxMaL" } }
});
await client.conversationalAi.agents.update("id", {
  conversationConfig: { agent: { prompt: { prompt: "New instructions.", llm: "claude-sonnet-4" } } }
});
```

**CLI:**
```bash
elevenlabs agents update --agent-id "your-agent-id" --json '{"name": "New Name"}'
```

#### Updatable Fields

| Section | Fields |
|---------|--------|
| Root | `name`, `tags` |
| `conversation_config.agent` | `first_message`, `language`, `disable_first_message_interruptions`, `dynamic_variables`, `text_behavior_overrides` |
| `conversation_config.agent.prompt` | `prompt`, `llm`, `temperature`, `max_tokens`, `reasoning_effort`, `tools`, `built_in_tools`, `enable_parallel_tool_calls`, `knowledge_base`, `custom_llm`, `timezone` |
| `conversation_config.tts` | `voice_id`, `model_id`, `stability`, `similarity_boost`, `speed`, `expressive_mode`, `enable_phoneme_tags` |
| `conversation_config.asr` | `quality`, `provider`, `keywords`, `user_input_audio_format` |
| `conversation_config.turn` | `turn_timeout`, `turn_eagerness`, `silence_end_call_timeout`, `turn_model`, `interruption_ignore_terms`, `interruption_ignore_term_languages`, `merge_with_default_ignore_terms`, `transcribe_on_disabled_interruptions`, `soft_timeout_config` |
| `conversation_config.conversation` | `max_duration_seconds`, `text_only`, `dtmf_input_settings`, `monitoring_enabled`, `background_sound` |
| `platform_settings` | `summary_language`, `auto_translate_transcript_to_app_language`, `analysis_items`, `queueing_config`, `guardrails`, `privacy`, `topic_discovery`, `sentiment_analysis`, `alerting` |
| `platform_settings.widget` | `dismissible`, `show_agent_status`, `show_conversation_id`, `strip_audio_tags`, `mic_muting_enabled`, `transcript_enabled`, `syntax_highlight_theme` |
| `platform_settings.auth` | `enable_auth`, `allowlist` |
| `platform_settings.call_limits` | `agent_concurrency_limit`, `daily_limit`, `bursting_enabled` |

### SDK: Delete Agent

```python
client.conversational_ai.agents.delete(agent_id="your-agent-id")
```

```javascript
await client.conversationalAi.agents.delete("your-agent-id");
```

```bash
elevenlabs agents delete --agent-id "your-agent-id"
```

## CI/CD Integration

Use the CLI in your deployment pipeline:

```bash
# Set API key as environment variable
export ELEVENLABS_API_KEY="your-api-key"

# Push changes (non-interactive)
elevenlabs agents push
```

## Example Configurations

### Customer Support Agent

```python
agent = client.conversational_ai.agents.create(
    name="Support Agent",
    conversation_config={
        "agent": {
            "first_message": "Hi! Thanks for calling TechCorp support.",
            "language": "en",
            "prompt": {
                "prompt": "You are a customer support agent. Be helpful, professional, concise.",
                "llm": "gemini-2.0-flash",
                "temperature": 0.5,
                "built_in_tools": {
                    "end_call": {},
                    "transfer_to_number": {
                        "transfers": [{"transfer_destination": {"type": "phone", "phone_number": "+1234567890"}, "condition": "User asks for human support"}]
                    }
                }
            }
        },
        "tts": {"voice_id": "XB0fDUnXU5powFXDhCwa", "model_id": "eleven_v4_turbo"},
        "turn": {"turn_eagerness": "normal", "turn_timeout": 7},
        "conversation": {"max_duration_seconds": 900}
    }
)
```

### Low-Latency Assistant

```python
agent = client.conversational_ai.agents.create(
    name="Quick Assistant",
    conversation_config={
        "agent": {
            "first_message": "Hey! What do you need?",
            "prompt": {
                "prompt": "Fast, efficient assistant. Brief answers.",
                "llm": "gemini-2.0-flash",
                "temperature": 0.3,
                "max_tokens": 100
            }
        },
        "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb", "model_id": "eleven_flash_v2_5"},  # Flash: lowest latency (~75ms)
        "turn": {"turn_eagerness": "eager", "turn_timeout": 3}
    }
)
```


# client-tools.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/client-tools.md

# Client Tools

Extend your agent with custom capabilities. Tools let the agent take actions beyond just talking.

## Tool Types

| Type | Execution | Use Case |
|------|-----------|----------|
| **Webhook** | Server-side via HTTP | Database queries, API calls, secure operations |
| **Client** | Browser-side JavaScript | UI updates, local storage, navigation |
| **System** | Built-in ElevenLabs | End call, transfer, standard actions |

## Where Tools Live

Tools are defined inside `conversation_config.agent.prompt`. Webhook and client tools go in the `tools` array. System tools go in `built_in_tools`:

```python
conversation_config={
    "agent": {
        "prompt": {
            "prompt": "You are helpful.",
            "llm": "gemini-2.0-flash",
            "tools": [...],            # Webhook and client tools
            "built_in_tools": {...}     # System tools (end_call, transfer, etc.)
        }
    }
}
```

## Webhook Tools

Execute server-side logic when the agent needs external data or actions.

### Basic Webhook

```python
agent = client.conversational_ai.agents.create(
    name="Weather Assistant",
    conversation_config={
        "agent": {
            "prompt": {
                "prompt": "You are a helpful assistant that can check the weather.",
                "llm": "gemini-2.0-flash",
                "tools": [{
                    "type": "webhook",
                    "name": "get_weather",
                    "description": "Get current weather for a city. Use when user asks about weather.",
                    "api_schema": {
                        "url": "https://api.example.com/weather",
                        "method": "POST",
                        "request_headers": {
                            "Authorization": "Bearer {{API_KEY}}"
                        },
                        "request_body_schema": {
                            "type": "object",
                            "properties": {
                                "city": {
                                    "type": "string",
                                    "description": "City name, e.g., 'San Francisco'"
                                },
                                "units": {
                                    "type": "string",
                                    "enum": ["celsius", "fahrenheit"],
                                    "description": "Temperature units"
                                }
                            },
                            "required": ["city"]
                        }
                    }
                }]
            }
        },
        "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb"}
    }
)
```

### Webhook Request Format

When the agent calls a webhook tool, ElevenLabs sends:

```json
{
  "tool_call_id": "call_abc123",
  "tool_name": "get_weather",
  "parameters": {
    "city": "San Francisco",
    "units": "fahrenheit"
  },
  "conversation_id": "conv_xyz789"
}
```

### Webhook Response Format

Your server should respond with:

```json
{
  "result": "The weather in San Francisco is 68°F and sunny."
}
```

Or for structured data:

```json
{
  "result": {
    "temperature": 68,
    "condition": "sunny",
    "humidity": 45
  }
}
```

### Webhook with Authentication

```python
# Inside conversation_config.agent.prompt.tools:
{
    "type": "webhook",
    "name": "lookup_order",
    "description": "Look up order status by order ID",
    "response_timeout_secs": 10,
    "api_schema": {
        "url": "https://api.mystore.com/orders/lookup",
        "method": "POST",
        "request_headers": {
            "Authorization": "Bearer {{ORDER_API_KEY}}",
            "X-Store-ID": "store_123"
        },
        "request_body_schema": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "Order ID (e.g., ORD-12345)"
                }
            },
            "required": ["order_id"]
        }
    }
}
```

Use workspace environment variables to keep a single server tool configuration working across
staging and production. `{{system_env__label}}` works in server tool URLs, secret environment
variables can populate `request_headers`, and auth-connection environment variables can populate
`api_schema.auth_connection`. The same environment-variable resolution model also applies to MCP
server connections.

```json
{
  "api_schema": {
    "url": "https://{{system_env__api_host}}.example.com/orders",
    "method": "GET",
    "request_headers": {
      "X-Api-Key": { "env_var_label": "orders_api_key" }
    },
    "auth_connection": { "env_var_label": "orders_oauth" }
  }
}
```

Workspace auth connections support OAuth2 client credentials, OAuth2 JWT, private key JWT,
basic auth, bearer auth, custom header auth, and mutual TLS (`mtls`).

System dynamic variables are also available in tool parameters and headers. Use
`{{system__conversation_history}}` when a webhook or sub-agent needs the full conversation
context as a lazily evaluated JSON history object with user, agent, and tool entries.

### Webhook Tool Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `response_timeout_secs` | int | `20` | Timeout in seconds (5-120) |
| `interruption_mode` | string | `"allow"` | Controls whether the user can interrupt around this tool call: `allow`, `disable_during_tool`, or `disable_during_tool_and_turn` |
| `execution_mode` | string | `"immediate"` | `immediate`, `post_tool_speech`, or `async` |
| `tool_call_sound` | string | - | Sound during execution: `typing`, `elevator1`-`elevator4` |
| `pre_tool_speech` | string | `"auto"` | Controls whether the agent speaks before execution: `auto`, `force`, or `off` |
| `tool_error_handling_mode` | string | `"auto"` | `auto`, `summarized`, `passthrough`, or `hide` |
| `api_schema.response_filter` | object | - | Filters JSON webhook responses before the LLM sees them. Use `mode: "allow"` with `filters` dot-paths to keep selected fields, or `mode: "hide_all"` to hide the response |

MCP server configuration supports the same `pre_tool_speech`, `interruption_mode`, `execution_mode`, and
`response_timeout_secs` controls at the server level, with per-tool overrides in
`tool_config_overrides`. Set a per-tool `tool_call_sound` override to `"off"` to silence that tool
while retaining the server default for other tools. MCP timeouts default to 30 seconds and must be
5-300 seconds.

Set `request_meta` on an MCP server configuration to send entries in the MCP `_meta` field of
`tools/call` requests. Values can be JSON scalars or references to workspace secrets, dynamic
variables, or environment variables that resolve for each call.

**Note:** The default `api_schema.method` is `GET`. Always set `"method": "POST"` explicitly for webhook tools that send request bodies.

### Server Implementation (Node.js)

```javascript
app.post("/webhook/get_weather", async (req, res) => {
  const { parameters, conversation_id } = req.body;
  const { city, units = "fahrenheit" } = parameters;

  // Fetch weather from your data source
  const weather = await weatherService.get(city, units);

  res.json({
    result: `It's ${weather.temp}°${units === "celsius" ? "C" : "F"} and ${weather.condition} in ${city}.`,
  });
});
```

### Server Implementation (Python)

```python
@app.post("/webhook/get_weather")
async def get_weather(request: Request):
    data = await request.json()
    city = data["parameters"]["city"]
    units = data["parameters"].get("units", "fahrenheit")

    # Fetch weather from your data source
    weather = weather_service.get(city, units)

    return {
        "result": f"It's {weather['temp']}°{'C' if units == 'celsius' else 'F'} and {weather['condition']} in {city}."
    }
```

## Client Tools

Execute JavaScript in the user's browser. Useful for UI updates, navigation, or accessing browser APIs.

### Defining Client Tools

Client tools are registered when starting a conversation:

```javascript
import { Conversation } from "@elevenlabs/client";

const conversation = await Conversation.startSession({
  agentId: "your-agent-id",
  clientTools: {
    show_product: async ({ productId }) => {
      // Update UI to show product
      const modal = document.getElementById("product-modal");
      modal.innerHTML = await fetchProductCard(productId);
      modal.showModal();
      return { success: true, message: "Showing product" };
    },

    navigate_to: async ({ page }) => {
      // Navigate to a page
      window.location.href = `/${page}`;
      return { success: true };
    },

    save_preference: async ({ key, value }) => {
      // Store in localStorage
      localStorage.setItem(key, value);
      return { saved: true };
    },
  },
});
```

### React Registration with `useConversationClientTool`

When you use the React SDK, wrap your component tree in `ConversationProvider` and register
client tools from components with `useConversationClientTool`. Handlers are cleaned up
automatically on unmount and always use the latest closure value. Prefer granular hooks such as
`useConversationControls` and `useConversationStatus` for the session UI; `useConversation`
remains available when you want the full conversation object in one hook.

```typescript
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationStatus,
} from "@elevenlabs/react";

function Storefront() {
  useConversationClientTool("show_product", async ({ productId }) => {
    const modal = document.getElementById("product-modal");
    modal.innerHTML = await fetchProductCard(productId);
    modal.showModal();
    return { success: true };
  });

  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();

  if (status === "connected") {
    return <button onClick={endSession}>End</button>;
  }

  return (
    <button onClick={() => startSession({ agentId: "your-agent-id" })}>
      Start
    </button>
  );
}

function App() {
  return (
    <ConversationProvider>
      <Storefront />
    </ConversationProvider>
  );
}
```

### Registering Client Tools with Agent

Tell the agent about available client tools in `conversation_config.agent.prompt.tools`:

```python
agent = client.conversational_ai.agents.create(
    name="Shopping Assistant",
    conversation_config={
        "agent": {
            "prompt": {
                "prompt": """You are a shopping assistant.
When users want to see a product, use show_product.
When users want to go somewhere, use navigate_to.""",
                "llm": "gemini-2.0-flash",
                "tools": [
                    {
                        "type": "client",
                        "name": "show_product",
                        "description": "Display a product card to the user",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "productId": {
                                    "type": "string",
                                    "description": "Product ID to display"
                                }
                            },
                            "required": ["productId"]
                        }
                    },
                    {
                        "type": "client",
                        "name": "navigate_to",
                        "description": "Navigate user to a different page",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "page": {
                                    "type": "string",
                                    "enum": ["cart", "checkout", "account", "home"],
                                    "description": "Page to navigate to"
                                }
                            },
                            "required": ["page"]
                        }
                    }
                ]
            }
        },
        "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb"}
    }
)
```

### Client Tool Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `expects_response` | bool | `false` | Whether the tool returns data to the agent |

### Client Tool Return Values

Return data that the agent can use in conversation:

```javascript
clientTools: {
  check_cart: async () => {
    const cart = JSON.parse(localStorage.getItem("cart") || "[]");
    return {
      itemCount: cart.length,
      total: cart.reduce((sum, item) => sum + item.price, 0),
      items: cart.map((item) => item.name),
    };
  };
}
```

The agent receives this data and can say: "You have 3 items in your cart totaling $45.99."

## System Tools (built_in_tools)

Built-in tools provided by ElevenLabs. These are configured in `conversation_config.agent.prompt.built_in_tools` (not in the `tools` array):

```python
"built_in_tools": {
    "end_call": {},
    "transfer_to_number": {...},
    "transfer_to_agent": {...},
    "language_detection": {},
    "skip_turn": {},
    "voicemail_detection": {...},
    "play_keypad_touch_tone": {}
}
```

Current API schemas also expose `agent_prompt_change`, `memory_entry_create`, `memory_entry_delete`, `memory_entry_search`, and `memory_entry_update` in `built_in_tools`.

Set `only_at_conversation_start: true` on the `language_detection` tool to constrain language
switching when no switch occurs in the first two user turns. Leave it `false` when the conversation
must remain able to switch languages later.

### end_call

Ends the current conversation:

```python
"built_in_tools": {
    "end_call": {}
}
```

The agent can say "Goodbye!" and then end the call programmatically.

### transfer_to_number

Transfer to a phone number (requires telephony integration):

```python
"built_in_tools": {
    "transfer_to_number": {
        "transfers": [{
            "transfer_destination": {"type": "phone", "phone_number": "+1234567890"},
            "condition": "User asks to speak with a human agent"
        }]
    }
}
```

### transfer_to_agent

Transfer to another ElevenLabs agent or workflow node:

```python
"built_in_tools": {
    "transfer_to_agent": {
        "transfers": [{
            "agent_id": "other-agent-id",
            "node_id": "destination-workflow-node-id",
            "preserve_client_tts_overrides": true,
            "condition": "User asks about sales"
        }]
    }
}
```

Use `node_id` when the transfer should start at a specific workflow node. Omit
`agent_id` when the transfer stays within the current agent's workflow.
Set `preserve_client_tts_overrides` when client-side TTS overrides should continue
after the transfer.

## Best Practices

### Tool Descriptions

Write clear descriptions so the LLM knows when to use tools:

```python
# Good - specific and actionable
"description": "Look up order status. Use when customer asks about their order, delivery, or shipping."

# Bad - vague
"description": "Order tool"
```

### Parameter Descriptions

Help the LLM extract correct values:

```python
"parameters": {
    "type": "object",
    "properties": {
        "order_id": {
            "type": "string",
            "description": "Order ID in format ORD-XXXXX (e.g., ORD-12345)"
        },
        "email": {
            "type": "string",
            "description": "Customer email address for verification"
        }
    }
}
```

For optional tool parameters that should never be sent in the request payload, set
`is_omitted: true` on the JSON schema property. Do not combine it with `description`,
`dynamic_variable`, `is_system_provided`, or `constant_value`.

For an LLM-supplied parameter that must match a runtime list, set
`allowed_values: {"dynamic_variable": "allowed_ids"}`. The dynamic variable must resolve to a
JSON array. Use `allowed_values` only with a `description`-sourced property; do not combine it with
`dynamic_variable`, `is_system_provided`, `constant_value`, or `is_omitted`.

### Error Handling

Configure how tool errors are shared with the agent using `tool_error_handling_mode`:

| Mode | Behavior |
|------|----------|
| `auto` | ElevenLabs automatically decides how to handle errors |
| `summarized` | Errors are summarized before being sent to the agent |
| `passthrough` | Full error details are passed to the agent |
| `hide` | Errors are hidden from the agent |

Return helpful error messages:

```javascript
// Server webhook
app.post("/webhook/lookup_order", async (req, res) => {
  const { order_id } = req.body.parameters;

  const order = await db.orders.find(order_id);

  if (!order) {
    return res.json({
      result: {
        error: true,
        message: `Order ${order_id} not found. Please verify the order ID.`,
      },
    });
  }

  res.json({ result: order });
});
```

### Timeouts

Set reasonable timeouts for webhooks using `response_timeout_secs` (5-120 seconds, default 20). MCP server tool calls use the same field with a 30-second default and a 5-300 second range:

```python
{
    "type": "webhook",
    "name": "slow_operation",
    "description": "Run a slow operation",
    "response_timeout_secs": 30,
    "api_schema": {
        "url": "https://api.example.com/slow-operation",
        "method": "POST"
    }
}
```

## Complete Example

```python
agent = client.conversational_ai.agents.create(
    name="E-commerce Assistant",
    conversation_config={
        "agent": {
            "first_message": "Hi! How can I help you today?",
            "language": "en",
            "prompt": {
                "prompt": """You are an e-commerce support assistant.

Available actions:
- lookup_order: Check order status
- show_product: Display products to customer
- end_call: End conversation politely
- transfer_to_number: Transfer to human support

Always verify order ID before lookup. Offer transfer for complex issues.""",
                "llm": "gemini-2.0-flash",
                "tools": [
                    # Webhook: Server-side order lookup
                    {
                        "type": "webhook",
                        "name": "lookup_order",
                        "description": "Look up order status by order ID or email",
                        "api_schema": {
                            "url": "https://api.mystore.com/orders/lookup",
                            "method": "POST",
                            "request_headers": {"Authorization": "Bearer {{API_KEY}}"},
                            "request_body_schema": {
                                "type": "object",
                                "properties": {
                                    "order_id": {"type": "string"},
                                    "email": {"type": "string"}
                                }
                            }
                        }
                    },
                    # Client: Browser-side product display
                    {
                        "type": "client",
                        "name": "show_product",
                        "description": "Display product details to the customer",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "product_id": {"type": "string"}
                            },
                            "required": ["product_id"]
                        }
                    }
                ],
                "built_in_tools": {
                    "end_call": {},
                    "transfer_to_number": {
                        "transfers": [{
                            "transfer_destination": {"type": "phone", "phone_number": "+1234567890"},
                            "condition": "User asks for human support"
                        }]
                    }
                }
            }
        },
        "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb", "model_id": "eleven_v4_turbo"}
    }
)
```


# installation.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/installation.md

# Installation

## CLI (Recommended)

The ElevenLabs CLI is the recommended way to create and manage agents:

```bash
# npm (any platform with Node.js)
npm install -g @elevenlabs/cli
```

```bash
# macOS / Linux (Homebrew)
brew install elevenlabs/tap/elevenlabs
```

```powershell
# Windows (Scoop)
scoop bucket add elevenlabs https://github.com/elevenlabs/scoop-bucket
scoop install elevenlabs
```

```bash
# Shell installer (any platform)
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/elevenlabs/cli/releases/latest/download/elevenlabs-cli-installer.sh | sh
```

### Authentication

Set `ELEVENLABS_API_KEY` in your environment — the CLI picks it up automatically:

```bash
export ELEVENLABS_API_KEY="your-api-key"
```

Or authenticate with OAuth, which stores credentials in the OS keyring:

```bash
elevenlabs auth login          # Authenticate with OAuth
elevenlabs auth whoami         # Verify current login status
elevenlabs auth logout         # Remove stored credentials
```

### Quick Start

```bash
# Initialize a new project
elevenlabs agents init

# Create an agent from template
elevenlabs agents add "My Assistant" --template default

# Push to ElevenLabs platform
elevenlabs agents push
```

## JavaScript / TypeScript SDK

For programmatic access and client-side integration:

```bash
npm install @elevenlabs/elevenlabs-js@latest
```

> **Important:** Always use `@elevenlabs/elevenlabs-js`. The old `elevenlabs` npm package (v1.x) is deprecated and should not be used.

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Option 1: Environment variable (recommended)
// Set ELEVENLABS_API_KEY in your environment
const client = new ElevenLabsClient();

// Option 2: Pass directly
const client = new ElevenLabsClient({ apiKey: "your-api-key" });
```

### Migrating from deprecated packages

If you have old packages installed, remove them:

```bash
# Remove deprecated packages
npm uninstall elevenlabs

# Install the current packages
npm install @elevenlabs/elevenlabs-js@latest

# For browser apps, install the package that matches your UI layer:
npm install @elevenlabs/client@latest  # Vanilla JavaScript in the browser
npm install @elevenlabs/react@latest   # React on the web
```

**Import changes:**
```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Conversation } from "@elevenlabs/client";
import {
  ConversationProvider,
  useConversationControls,
  useConversationStatus,
} from "@elevenlabs/react";
```

`@elevenlabs/react` re-exports `@elevenlabs/client`, so React apps usually only need
`@elevenlabs/react`. Wrap hook consumers in `ConversationProvider` and prefer granular hooks
such as `useConversationControls` and `useConversationStatus`; `useConversation` remains
available as the convenience all-in-one hook.

Use `@elevenlabs/react-native` for React Native projects with the same provider-and-hooks API;
only the import path changes.

## Python

```bash
pip install elevenlabs
```

```python
from elevenlabs import ElevenLabs

# Option 1: Environment variable (recommended)
# Set ELEVENLABS_API_KEY in your environment
client = ElevenLabs()

# Option 2: Pass directly
client = ElevenLabs(api_key="your-api-key")
```

## CLI Usage

Every REST endpoint is available as a CLI subcommand. Set your API key as an environment variable and the CLI picks it up automatically — no headers or key flags needed:

```bash
export ELEVENLABS_API_KEY="your-api-key"

elevenlabs agents create \
  --json '{"name": "My Agent", "conversation_config": {"agent": {"prompt": {"prompt": "You are helpful.", "llm": "gemini-2.0-flash"}}, "tts": {"voice_id": "JBFqnCBsd6RMkjVDRZzb"}}}'
```

## Getting an API Key

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to [API Keys](https://elevenlabs.io/app/settings/api-keys)
3. Click **Create API Key**
4. Copy and store securely

Or use the `setup-api-key` skill for guided setup.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key (required) |


# outbound-calls.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/outbound-calls.md

# Outbound Calls

Make outbound phone calls using your ElevenLabs agent via Twilio or Exotel integration.

## Prerequisites

1. A configured ElevenLabs agent
2. A Twilio or Exotel phone number linked to your agent
3. Your ElevenLabs API key

## Find a linked phone number

List phone numbers that support outbound calls and filter by the assigned agent:

### Python

```python
phone_numbers = client.conversational_ai.phone_numbers.list_v_2(
    agent_id="your-agent-id",
    supports_outbound=True,
    page_size=100,
)
```

### JavaScript

```javascript
const phoneNumbers = await client.conversationalAi.phoneNumbers.listV2({
  agentId: "your-agent-id",
  supportsOutbound: true,
  pageSize: 100,
});
```

Use the returned `phone_number_id` (`phoneNumberId` in JavaScript) as
`agent_phone_number_id`. When `has_more` (`hasMore`) is true, pass `next_cursor`
(`nextCursor`) as `cursor` to retrieve the next page. See the
[phone number list API](https://elevenlabs.io/docs/api-reference/phone-numbers/list-v-2)
for additional filters.

## Basic Usage

See the [main agents skill](../SKILL.md#outbound-calls) for basic Twilio Python, JavaScript, and CLI examples.

## Request Parameters

| Parameter | Type | Provider | Required | Description |
|-----------|------|----------|----------|-------------|
| `agent_id` | string | Twilio, Exotel | Yes | The ID of your ElevenLabs agent |
| `agent_phone_number_id` | string | Twilio, Exotel | Yes | The ID of the linked phone number |
| `to_number` | string | Twilio, Exotel | Yes | The destination phone number in E.164 format |
| `conversation_initiation_client_data` | object | Twilio, Exotel | No | Override conversation settings for this call |
| `telephony_call_config` | object | Twilio, Exotel | No | Telephony call settings like ringing timeout |
| `call_recording_enabled` | boolean | Twilio | No | Whether to let Twilio record the call |

`conversation_initiation_client_data` also accepts `branch_id` to route the call to a specific
agent branch and `environment` to control how environment variables resolve for that call.

## Response

```json
{
  "success": true,
  "message": "Call initiated successfully",
  "conversation_id": "conv_abc123",
  "callSid": "CA1234567890abcdef"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the call was initiated successfully |
| `message` | string | Status message |
| `conversation_id` | string | ElevenLabs conversation ID for tracking |
| `callSid` | string | Provider call SID for reference |

## Exotel Calls

Use the Exotel endpoint when the linked phone number uses the Exotel provider:

```bash
elevenlabs agents exotel outbound_call \
  --agent-id "your-agent-id" \
  --agent-phone-number-id "your-phone-number-id" \
  --to-number "+1234567890"
```

## Customizing the Call

Override agent settings for a specific call using `conversation_initiation_client_data`:

### Python

```python
response = client.conversational_ai.twilio.outbound_call(
    agent_id="your-agent-id",
    agent_phone_number_id="your-phone-number-id",
    to_number="+1234567890",
    call_recording_enabled=True,
    conversation_initiation_client_data={
        "branch_id": "branch_support_staging",
        "environment": "staging",
        "conversation_config_override": {
            "agent": {
                "first_message": "Hello! This is a reminder about your appointment tomorrow.",
                "language": "en"
            },
            "tts": {
                "voice_id": "JBFqnCBsd6RMkjVDRZzb"
            }
        },
        "dynamic_variables": {
            "customer_name": "John",
            "appointment_time": "2:00 PM"
        }
    }
)
```

### JavaScript

```javascript
const response = await client.conversationalAi.twilio.outboundCall({
  agentId: "your-agent-id",
  agentPhoneNumberId: "your-phone-number-id",
  toNumber: "+1234567890",
  callRecordingEnabled: true,
  conversationInitiationClientData: {
    branchId: "branch_support_staging",
    environment: "staging",
    conversationConfigOverride: {
      agent: {
        firstMessage: "Hello! This is a reminder about your appointment tomorrow.",
        language: "en",
      },
      tts: {
        voiceId: "JBFqnCBsd6RMkjVDRZzb",
      },
    },
    dynamicVariables: {
      customer_name: "John",
      appointment_time: "2:00 PM",
    },
  },
});
```

## Configuration Overrides

### Agent Settings

| Option | Type | Description |
|--------|------|-------------|
| `first_message` | string | Custom greeting for this call |
| `language` | string | Language code (e.g., "en", "es", "fr") |
| `prompt` | object | Override agent prompt and LLM settings |

### TTS Settings

| Option | Type | Description |
|--------|------|-------------|
| `voice_id` | string | Voice ID to use for this call |
| `stability` | number | Voice stability (0.0-1.0) |
| `similarity_boost` | number | Voice similarity boost (0.0-1.0) |
| `speed` | number | Speech speed multiplier |
| `pronunciation_dictionary_locators` | array | Pronunciation dictionaries for the call; each locator requires `pronunciation_dictionary_id` and `version_id` |

### Conversation Settings

| Option | Type | Description |
|--------|------|-------------|
| `max_duration_seconds` | integer | Maximum duration of this conversation in seconds |

### Telephony Call Configuration

| Option | Type | Description |
|--------|------|-------------|
| `ringing_timeout_secs` | integer | How long to ring the recipient before giving up (default: `60`) |
| `twilio_machine_detection` | object or null | Twilio answering-machine detection settings. Omit or set to `null` to disable. Ignored for non-Twilio providers and inbound calls. |

Set `twilio_machine_detection.mode` to `enable` for an early human-or-machine verdict or
`detect_message_end` to wait for the end of a voicemail greeting. The default is `enable`.
Detection runs asynchronously. Its verdict arrives through the separate
`answering_machine_detection` webhook event, which must be enabled in the workspace or agent
webhook settings.

### Dynamic Variables

Pass custom data to your agent's prompt using `dynamic_variables`. Reference them in your agent's prompt with `{{variable_name}}` syntax.

### Branch and Environment Routing

Use `branch_id` inside `conversation_initiation_client_data` for per-call branch routing on
Twilio, Exotel, or SIP trunk outbound calls. Use `environment` alongside it when the call should resolve
workspace environment variables against a non-default deployment target such as `staging` or
`production`.

When assigning dynamic variables, you can use the `sanitize` option to remove sensitive values from tool responses before they are sent to the LLM and transcript, while still allowing variable assignment:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sanitize` | boolean | `false` | If true, the assignment's value is removed from tool responses before sending to LLM/transcript but still processed for variable assignment |

## Complete Example

```python
from elevenlabs import ElevenLabs

client = ElevenLabs()

# Make personalized outbound calls
customers = [
    {"name": "Alice", "phone": "+1234567890", "balance": "$150.00"},
    {"name": "Bob", "phone": "+0987654321", "balance": "$75.50"},
]

for customer in customers:
    try:
        response = client.conversational_ai.twilio.outbound_call(
            agent_id="payment-reminder-agent",
            agent_phone_number_id="your-phone-number-id",
            to_number=customer["phone"],
            call_recording_enabled=True,
            conversation_initiation_client_data={
                "conversation_config_override": {
                    "agent": {
                        "first_message": f"Hello {customer['name']}, this is a friendly reminder about your account."
                    }
                },
                "dynamic_variables": {
                    "customer_name": customer["name"],
                    "balance": customer["balance"]
                }
            }
        )
        print(f"Called {customer['name']}: {response.conversation_id}")
    except Exception as e:
        print(f"Failed to call {customer['name']}: {e}")
```


# using-procedure-api.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/using-procedure-api.md

# Using the Procedure API

Procedures are reusable instruction blocks that an agent runs when a trigger matches. Use the ElevenLabs CLI by default to create, edit, and publish them. Python and JavaScript SDKs are also available for application code. Reference: [Procedures](https://elevenlabs.io/docs/eleven-agents/customization/procedures.md) · [API Reference](https://elevenlabs.io/docs/api-reference/agents/procedures/).

For what belongs in `trigger` and `content`, see [Writing Procedures](writing-procedures.md).

One term to know: turning a structured procedure's steps into the form the agent executes is called compiling. The platform compiles every structured procedure on the branch when you publish; you never compile anything yourself or send a `workflow` in a request. The compiled result is currently visible as read-only nodes in the dashboard's Workflow tab.

The CLI exposes the complete procedure lifecycle, including draft operations.

## Prerequisites

- `ELEVENLABS_API_KEY` is set, with the `CONVAI_READ` and `CONVAI_WRITE` scopes.
- Reading requires the viewer role on the target agent. Creating, updating, removing, and publishing require the editor role. Publishing to a protected branch requires admin.
- The target `agent_id` is known.
- The target `branch_id` is known. If not, read `main_branch_id` with `elevenlabs agents get --agent-id "$AGENT_ID" --query main_branch_id`, or list branches with `elevenlabs agents branches list --agent-id "$AGENT_ID"`.

```bash
AGENT_ID="your-agent-id"
BRANCH_ID="your-branch-id"
```

The CLI reads `ELEVENLABS_API_KEY` from the environment automatically; never pass the key as a flag, and never print or persist it.

## CLI

Use these command groups for procedure management:

| Operation | Command |
|-----------|---------|
| List, create, read, remove | `elevenlabs agents procedures ...` |
| Read, update, discard draft | `elevenlabs agents procedures drafts ...` |
| Publish pending changes | `elevenlabs agents update` |

Use `--dry-run` to validate and inspect a generated request without sending it. Use `--schema`
on any command to inspect its machine-readable input and output contract.

## SDKs

Procedure APIs are available in both SDKs starting in `2.60.0`. Earlier versions do not include a `procedures` client, so install at or above that version:

```bash
pip install "elevenlabs>=2.60.0"
npm install @elevenlabs/elevenlabs-js@^2.60.0
```

For JavaScript, use `@elevenlabs/elevenlabs-js`. The unscoped `elevenlabs` npm package is the deprecated v1.x and has no procedures client at any version.

Both clients read `ELEVENLABS_API_KEY` from the environment; never pass a literal key.

Use these SDK methods for the procedure endpoints. Python nests them under `client.conversational_ai.agents`; JavaScript uses `client.conversationalAi.agents`:

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List | `GET .../procedures` | `procedures.list` |
| Create | `POST .../procedures` | `procedures.create` |
| Read branch HEAD | `GET .../procedures/{procedure_id}` | `procedures.get` |
| Read draft | `GET .../procedures/{procedure_id}/draft` | `procedures.drafts.get` |
| Update draft | `PATCH .../procedures/{procedure_id}/draft` | `procedures.drafts.update` |
| Discard draft | `DELETE .../procedures/{procedure_id}/draft` | `procedures.drafts.delete` |
| Remove | `DELETE .../procedures/{procedure_id}` | `procedures.remove` |
| Publish | `PATCH /v1/convai/agents/{agent_id}?branch_id=...` | `agents.update` |

SDK notes:

- JavaScript takes the IDs positionally, then a body object. Python takes keyword arguments — except `procedures.create`, which takes its body as `request=CreateProcedureRequestModel(...)`. Flat keywords on `create` raise `TypeError`.
- Read one historical version with `procedures.get(..., version_id=...)` or `procedures.get(agentId, branchId, procedureId, { versionId })`.
- Pass `agent_version_id` to `procedures.list` or `procedures.get` to resolve the procedures attached to a specific agent version.
- To publish, call `agents.update` with `branch_id` and an optional `version_description`. That is the whole call.

The flow below creates a free-form procedure, edits its draft, and publishes it.

### Python

```python
from elevenlabs import ElevenLabs
from elevenlabs.types import CreateProcedureRequestModel

client = ElevenLabs()
procedures = client.conversational_ai.agents.procedures

created = procedures.create(
    agent_id=AGENT_ID,
    branch_id=BRANCH_ID,
    request=CreateProcedureRequestModel(
        name="Refund requests",
        type="free_form",
        trigger="When the user asks for a refund",
        content="Confirm the order number, check eligibility, and explain the next step.",
    ),
)

draft = procedures.drafts.get(
    agent_id=AGENT_ID, branch_id=BRANCH_ID, procedure_id=created.procedure_id
)
procedures.drafts.update(
    agent_id=AGENT_ID,
    branch_id=BRANCH_ID,
    procedure_id=created.procedure_id,
    name=draft.name,
    type="free_form",
    trigger=draft.trigger,
    content="Confirm the order number. Check refund eligibility. Explain the refund timeline.",
)

client.conversational_ai.agents.update(
    agent_id=AGENT_ID,
    branch_id=BRANCH_ID,
    version_description="Publish refund procedure",
)
```

If the branch has structured procedures, the publish validates them. Catch the validation error and repair the procedure draft:

```python
from elevenlabs.errors import BadRequestError

try:
    client.conversational_ai.agents.update(
        agent_id=AGENT_ID,
        branch_id=BRANCH_ID,
        version_description="Publish refund procedure",
    )
except BadRequestError as error:
    detail = error.body.get("detail", {})
    if detail.get("status") == "procedure_validation_failed":
        for procedure_id, errors in detail["data"]["errors"].items():
            for item in errors:
                print(procedure_id, item["path"], item["message"])
    raise
```

### JavaScript

```javascript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient();
const procedures = client.conversationalAi.agents.procedures;

const created = await procedures.create(agentId, branchId, {
  name: "Refund requests",
  type: "free_form",
  trigger: "When the user asks for a refund",
  content: "Confirm the order number, check eligibility, and explain the next step.",
});

const draft = await procedures.drafts.get(agentId, branchId, created.procedureId);
await procedures.drafts.update(agentId, branchId, created.procedureId, {
  name: draft.name,
  type: "free_form",
  trigger: draft.trigger,
  content: "Confirm the order number. Check refund eligibility. Explain the refund timeline.",
});

await client.conversationalAi.agents.update(agentId, {
  branchId,
  versionDescription: "Publish refund procedure",
});
```

If the branch has structured procedures, the publish validates them. Catch the validation error and repair the procedure draft:

```javascript
import { ElevenLabsError } from "@elevenlabs/elevenlabs-js";

try {
  await client.conversationalAi.agents.update(agentId, {
    branchId,
    versionDescription: "Publish refund procedure",
  });
} catch (error) {
  if (error instanceof ElevenLabsError && error.statusCode === 400) {
    const detail = error.body?.detail;
    if (detail?.status === "procedure_validation_failed") {
      for (const [procedureId, errors] of Object.entries(detail.data.errors)) {
        for (const item of errors) console.error(procedureId, item.path, item.message);
      }
    }
  }
  throw error;
}
```

## Procedure Lifecycle

- Procedures belong to an agent branch. Drafts are scoped to the current user.
- Create, update, discard, and remove act on your draft working set. Nothing reaches the live agent until you publish.
- Publishing is not a procedure endpoint. Use `PATCH /v1/convai/agents/{agent_id}?branch_id=...` to version all changed procedure drafts on the branch.
- Each branch maps every `procedure_id` to a published `version_id`, or to no version while only a draft exists. A branch-HEAD read therefore returns `404` until the first publish.
- Publishing validates structured procedures. If one is invalid, the publish fails with `procedure_validation_failed` and nothing is written. See [Publish](#publish). To run the same check without publishing, save an agent draft; see [Validate without publishing](#validate-without-publishing).
- A procedure's `type` cannot change after creation. A draft update with a different `type` is rejected.
- Draft writes are last-write-wins. Read the draft immediately before editing and avoid concurrent writers.

Reads resolve against different sources:

| Request | Returns |
|---------|---------|
| `GET .../procedures/{procedure_id}` | Branch HEAD. `404` until the procedure's first publish. |
| `GET .../procedures/{procedure_id}/draft` | Your draft, falling back to branch HEAD when you have none. |
| `GET .../procedures/{procedure_id}?version_id=...` | One pinned, immutable historical version. |

## List Procedures

List the effective working set:

```bash
elevenlabs agents procedures list \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID"
```

In the SDKs, pass `agent_version_id` when you need the procedure versions attached to one
immutable agent version.

Each entry carries `procedure_id`, `version_id`, `name`, `type`, `trigger`, and `has_draft`. `has_draft` is true when the procedure has unpublished draft changes on this branch, in which case its `name`, `type`, and `trigger` reflect that draft. `version_id` is the version published on this branch, and is null exactly when `has_draft` is true — including for a procedure that was published earlier and has since been edited.

The list does not include procedure content. Read a body with `GET .../procedures/{procedure_id}` or its `/draft` variant.

## Create

```bash
CREATE_RESPONSE=$(
  elevenlabs agents procedures create \
    --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" \
    --json '{
      "name": "Refund requests",
      "type": "free_form",
      "trigger": "When the user asks for a refund",
      "content": "Confirm the order number, check eligibility, and explain the next step."
    }'
)
PROCEDURE_ID=$(printf '%s' "$CREATE_RESPONSE" | jq -r '.procedure_id')
```

Fail if `procedure_id` is empty or null.

A structured procedure uses the same endpoint with `type` set to `deterministic` and its steps JSON-encoded into `content`. See [Writing Procedures](writing-procedures.md) for what belongs in `trigger` and `content`, and for building that JSON string.

## Read and Update the Draft

```bash
elevenlabs agents procedures drafts get \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" --procedure-id "$PROCEDURE_ID"

elevenlabs agents procedures drafts update \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" --procedure-id "$PROCEDURE_ID" \
  --json '{
    "name": "Refund requests",
    "type": "free_form",
    "trigger": "When the user asks for a refund",
    "content": "Confirm the order number. Check refund eligibility. Explain the refund timeline."
  }'
```

Treat the draft update body as a full replacement. Read the current draft, preserve `name` and `trigger` unless the user requested changes to them, and send them with the new `content`. Always send the existing `type`; it cannot change after creation, and a different value is rejected with `procedure_type_cannot_change`. Always send `trigger` explicitly rather than relying on a trigger embedded in `content`.

Publish with the flow under [Publish](#publish).

## Publish

One publish versions every changed procedure draft on the branch:

```bash
elevenlabs agents update \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" \
  --json '{"version_description": "Publish refund procedure"}'
```

If the branch has structured procedures, the publish validates each one and, if all pass, publishes them in the new version. The publish above is the whole call. This also runs when the change was free-form only, and when the last structured procedure was removed, in which case its compiled result is removed.

On a validation failure the publish returns `400` and nothing is written:

```json
{
  "detail": {
    "status": "procedure_validation_failed",
    "message": "Structured procedures failed validation.",
    "data": {
      "errors": {
        "agtprc_abc123": [
          { "path": "steps[0].ask.instruction", "message": "Step 1: Ask step requires an instruction" }
        ]
      }
    }
  }
}
```

`errors` is keyed by procedure ID. Each entry carries the `path` of the offending field and a message naming the step. Repair every entry in the procedure draft and publish again. Each attempt reports the errors detected in that pass; fixing field-level errors may reveal structural errors on the next pass.

Saving a procedure draft with `PATCH .../procedures/{procedure_id}/draft` does not validate structured content. The check happens at publish, or at agent draft save as described next.

The legacy `POST .../procedures/compile` endpoint still exists as a dry-run for existing callers, but do not use it. It will eventually be deprecated.

### Validate without publishing

A failed publish writes nothing, so when you are ready to publish, the publish itself is the validation step. Use the flow below only when you need to check structured content and are not ready to publish, for example while other edits on the branch are still pending, or on a protected branch you cannot publish to.

Saving an agent draft runs the same validation as publish and returns the same `procedure_validation_failed` payload. This is how the dashboard surfaces errors while editing. The endpoint is `POST /v1/convai/agents/{agent_id}/drafts?branch_id=...` (`agents.drafts.create` in the SDKs). There is no CLI command for it.

The body is the full agent draft, not a flag: `name`, `conversation_config`, `platform_settings`, and `workflow` are all required. Read them from the agent and resend them unchanged. Do not edit anything else in that body; a validation check is not the place to change agent configuration.

```bash
AGENT=$(
  curl -sS "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID?branch_id=$BRANCH_ID" \
    -H "xi-api-key: $ELEVENLABS_API_KEY"
)

curl -sS -X POST "https://api.elevenlabs.io/v1/convai/agents/$AGENT_ID/drafts?branch_id=$BRANCH_ID" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(printf '%s' "$AGENT" | jq '{name, conversation_config, platform_settings, workflow}')"
```

A `400` with `procedure_validation_failed` carries the same `errors` map as a failed publish. Repair the procedure draft with `PATCH .../procedures/{procedure_id}/draft` and save the agent draft again.

A `200` means every structured procedure on the branch validated, and it also stored an agent draft for you on that branch. If you only wanted the check, discard it with `DELETE /v1/convai/agents/{agent_id}/drafts?branch_id=...` (`agents.drafts.delete`) so it does not linger as an unsaved change in the dashboard. Discarding the agent draft does not touch your procedure drafts.

Verify a published procedure and record its `version_id`:

```bash
elevenlabs agents procedures get \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" --procedure-id "$PROCEDURE_ID"
```

## Discard Edits

Discard only your own unpublished draft:

```bash
elevenlabs agents procedures drafts delete \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" --procedure-id "$PROCEDURE_ID"
```

This restores the branch-HEAD version. For a procedure that was never published, it deletes the procedure. Read the draft afterwards to confirm what remains.

## Remove a Procedure

Stage the removal:

```bash
elevenlabs agents procedures remove \
  --agent-id "$AGENT_ID" --branch-id "$BRANCH_ID" --procedure-id "$PROCEDURE_ID"
```

This removes the procedure from the branch working set. It does not erase versions still referenced by agent history.

The removal remains a draft until published. Publishing removes the compiled result of a structured procedure along with it. Then confirm that the procedure is absent from the list and that a branch-HEAD lookup returns `404`.

## Error Handling

Common errors:
- **400** from publish or agent draft save, with `status` `procedure_validation_failed`: a structured procedure is invalid. Fix every entry under `detail.data.errors` and publish again.
- **400** from a procedure draft update, with `procedure_type_cannot_change`: the body's `type` differs from the procedure's type. Resend the existing type.
- **401**: `ELEVENLABS_API_KEY` is unset or invalid.
- **403**: the key lacks `CONVAI_READ`/`CONVAI_WRITE`, the agent role is too low, or the branch is protected and only admins may publish to it.
- **404**: verify that the agent, branch, and procedure IDs belong together. Before a procedure's first publish, read the draft endpoint rather than branch HEAD.

The SDKs raise for these responses. The payload is on `error.body`, and the status is on `error.status_code` in Python or `error.statusCode` in JavaScript.

Do not blindly retry create, update, delete, or publish requests. Read current state before deciding whether a retry is safe.


# widget-embedding.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/widget-embedding.md

# Widget Embedding

Add an ElevenLabs agent to any website with the conversation widget.

## Basic Embed

```html
<elevenlabs-convai agent-id="your-agent-id"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
```

This creates a floating launcher. Voice-only agents show a call entry point, text-only agents
show a message entry point, and multimodal agents show both.

> **Note:** Widgets currently require public agents with authentication disabled. For authenticated flows, use the SDKs.

## Widget Attributes

### Required

| Attribute | Description |
|-----------|-------------|
| `agent-id` | Your ElevenLabs agent ID |
| `signed-url` | Alternative to `agent-id` when using signed URLs |

### Appearance

| Attribute | Description | Default |
|-----------|-------------|---------|
| `avatar-image-url` | URL for agent avatar image | ElevenLabs logo |
| `avatar-orb-color-1` | Primary orb gradient color | `#2792dc` |
| `avatar-orb-color-2` | Secondary orb gradient color | `#9ce6e6` |

### Text Labels

| Attribute | Description | Default |
|-----------|-------------|---------|
| `action-text` | Tooltip when hovering | "Talk to AI" |
| `start-call-text` | Button to start call | "Start call" |
| `end-call-text` | Button to end call | "End call" |
| `expand-text` | Expand chat button | "Open" |
| `collapse-text` | Collapse chat button | "Close" |
| `listening-text` | Listening state label | "Listening..." |
| `speaking-text` | Speaking state label | "Assistant speaking" |

### Behavior

| Attribute | Description | Default |
|-----------|-------------|---------|
| `variant` | Widget style: `compact` or `expanded` | `compact` |
| `server-location` | Server region (`us`, `eu-residency`, `in-residency`, `global`) | `us` |
| `dismissible` | Allow the user to minimize the widget | `false` |
| `disable-banner` | Hide "Powered by ElevenLabs" | `false` |
| `show-resize-button` | Show the expand and collapse control in the widget header | `true` |

## Examples

### Custom Avatar

```html
<elevenlabs-convai
  agent-id="your-agent-id"
  avatar-image-url="https://example.com/your-avatar.png"
></elevenlabs-convai>
```

### Custom Colors

```html
<elevenlabs-convai
  agent-id="your-agent-id"
  avatar-orb-color-1="#ff6b6b"
  avatar-orb-color-2="#ffd93d"
></elevenlabs-convai>
```

### Custom Text

```html
<elevenlabs-convai
  agent-id="your-agent-id"
  action-text="Chat with our AI assistant"
  start-call-text="Begin conversation"
  end-call-text="Hang up"
></elevenlabs-convai>
```

### Expanded Variant

```html
<elevenlabs-convai
  agent-id="your-agent-id"
  variant="expanded"
></elevenlabs-convai>
```

### File Uploads

Embedded chat widgets can accept image and PDF uploads when the agent uses a multimodal LLM and
`conversation_config.conversation.file_input.enabled` is enabled. Configure
`max_files_per_conversation` to cap uploads per conversation.

### Full Customization

```html
<elevenlabs-convai
  agent-id="your-agent-id"
  avatar-image-url="https://example.com/support-agent.png"
  avatar-orb-color-1="#4f46e5"
  avatar-orb-color-2="#818cf8"
  action-text="Talk to Support"
  start-call-text="Start voice chat"
  end-call-text="End conversation"
  expand-text="Open assistant"
  collapse-text="Minimize"
></elevenlabs-convai>
```

## CSS Customization

The widget uses Shadow DOM but exposes CSS custom properties:

```css
elevenlabs-convai {
  --elevenlabs-convai-widget-width: 400px;
  --elevenlabs-convai-widget-height: 600px;
}
```

### Positioning

By default, the widget appears in the bottom-right corner. Override with CSS:

```css
elevenlabs-convai {
  position: fixed;
  bottom: 20px;
  right: 20px;
  /* Or position differently */
  left: 20px;
  right: auto;
}
```

### Z-Index

```css
elevenlabs-convai {
  z-index: 9999;
}
```

## JavaScript Control

Access the widget element to control it programmatically:

```html
<elevenlabs-convai id="my-widget" agent-id="your-agent-id"></elevenlabs-convai>

<script>
  const widget = document.getElementById("my-widget");

  // Start a conversation
  widget.startConversation();

  // End the conversation
  widget.endConversation();

  // Listen for events
  widget.addEventListener("conversationStarted", () => {
    console.log("Conversation started");
  });

  widget.addEventListener("conversationEnded", () => {
    console.log("Conversation ended");
  });
</script>
```

### Custom Trigger Button

Hide the default widget and use your own button:

```html
<style>
  elevenlabs-convai {
    display: none;
  }
</style>

<button onclick="document.getElementById('widget').startConversation()">
  Talk to AI
</button>

<elevenlabs-convai id="widget" agent-id="your-agent-id"></elevenlabs-convai>
```

## Authentication

For agents with authentication enabled, pass a signed URL:

```html
<elevenlabs-convai id="widget" agent-id="your-agent-id"></elevenlabs-convai>

<script>
  async function startAuthenticatedConversation() {
    // Get signed URL from your backend
    const response = await fetch("/api/get-signed-url");
    const { signedUrl } = await response.json();

    const widget = document.getElementById("widget");
    widget.setAttribute("signed-url", signedUrl);
    widget.startConversation();
  }
</script>
```

Your backend:

```python
@app.get("/api/get-signed-url")
def get_signed_url():
    signed_url = client.conversational_ai.conversations.get_signed_url(
        agent_id="your-agent-id"
    )
    return {"signedUrl": signed_url.signed_url}
```

## Mobile Considerations

### Responsive Positioning

```css
/* Desktop: bottom-right */
elevenlabs-convai {
  position: fixed;
  bottom: 20px;
  right: 20px;
}

/* Mobile: full-width bottom */
@media (max-width: 768px) {
  elevenlabs-convai {
    bottom: 0;
    right: 0;
    left: 0;
    --elevenlabs-convai-widget-width: 100%;
  }
}
```

### Touch-Friendly

The widget is touch-optimized by default. For better mobile UX:

```css
@media (max-width: 768px) {
  elevenlabs-convai {
    /* Larger touch target */
    transform: scale(1.1);
    transform-origin: bottom right;
  }
}
```

## Multiple Widgets

You can have multiple widgets for different agents:

```html
<elevenlabs-convai
  agent-id="support-agent-id"
  action-text="Support"
  style="right: 20px"
></elevenlabs-convai>

<elevenlabs-convai
  agent-id="sales-agent-id"
  action-text="Sales"
  style="right: 100px"
></elevenlabs-convai>
```

## Framework Integration

### React

```jsx
function App() {
  useEffect(() => {
    // Load widget script
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
    script.async = true;
    document.body.appendChild(script);

    return () => document.body.removeChild(script);
  }, []);

  return (
    <div>
      <elevenlabs-convai agent-id="your-agent-id"></elevenlabs-convai>
    </div>
  );
}
```

### Vue

```vue
<template>
  <div>
    <elevenlabs-convai agent-id="your-agent-id"></elevenlabs-convai>
  </div>
</template>

<script setup>
import { onMounted } from "vue";

onMounted(() => {
  const script = document.createElement("script");
  script.src = "https://unpkg.com/@elevenlabs/convai-widget-embed";
  script.async = true;
  document.body.appendChild(script);
});
</script>
```

### Next.js

```jsx
import Script from "next/script";

export default function Page() {
  return (
    <>
      <Script
        src="https://unpkg.com/@elevenlabs/convai-widget-embed"
        strategy="lazyOnload"
      />
      <elevenlabs-convai agent-id="your-agent-id"></elevenlabs-convai>
    </>
  );
}
```

## Troubleshooting

### Widget Not Appearing

1. Check that the agent ID is correct
2. Verify the script is loaded (check Network tab)
3. Check for JavaScript errors in console
4. Ensure no CSS is hiding the widget

### Audio Issues

1. Ensure HTTPS (microphone requires secure context)
2. Check browser permissions for microphone
3. Test in a supported browser (Chrome, Firefox, Safari, Edge)

### CORS Errors

If using authentication, ensure your domain is in the agent's allowlist:

```python
platform_settings={
    "auth": {
        "enable_auth": True,
        "allowlist": ["https://yourdomain.com"]
    }
}
```


# writing-procedures.md
> מיקום: /tmp/skills-use-A6gSIV/agents/references/writing-procedures.md

# Writing Procedures

Check the current documentation before authoring procedure content:

- [Procedures](https://elevenlabs.io/docs/eleven-agents/customization/procedures.md) — what a procedure is, and when to use one instead of a workflow or the system prompt.
- [Free-form procedures](https://elevenlabs.io/docs/eleven-agents/customization/procedures/free-form-procedures.md) — anatomy, inline references, and how to write triggers and content.
- [Structured procedures](https://elevenlabs.io/docs/eleven-agents/customization/procedures/structured-procedures.md) — step types, branching, and the rules on branches.

## Authoring Rules

- A procedure has a `name`, a `trigger`, and `content`. The agent uses the trigger for routing and reads the content when the procedure starts.
- Use `free_form` for natural-language guidance that the agent can adapt. Only free-form procedures can reference knowledge base documents.
- Use `deterministic` ("structured" in the dashboard) for typed steps that run in a fixed order, such as identity verification, escalation, or payment collection.
- A procedure's `type` cannot change after creation. Always resend the existing `type` on a draft update. To convert between free-form and structured, create a new procedure and re-point any references to it.
- Write concrete, non-overlapping triggers from the user's perspective. Cover likely phrasing: `When the user asks to refund, return, or get money back for an order` routes better than `When the user requests a refund`.
- An empty `trigger` marks a sub-procedure that runs only when another procedure references it. Set `trigger` as its own field; do not embed a trigger inside `content`.
- Content is capped at 50,000 characters for both types.
- Keep each procedure focused on one task. Put tone and refusal policy in the system prompt.
- Extract steps shared across procedures into a separate procedure and reference it, rather than copying the steps. Copies drift.

## Free-Form Content

Write `content` as markdown. Use numbered steps for sequences and bullets for requirements within a step. Use the imperative. Explain a step's rationale only when it helps the agent handle cases the procedure does not enumerate.

Reference a tool, knowledge base document, or another procedure inline. The `id` binds the resource; `name` provides a readable label.

An inline reference attaches the resource automatically. Naming a tool in prose works only when it is already attached to the agent, so prefer the markup.

```markdown
1. Ask the user for their order ID.
2. Look it up with [tool id="tool_abc123" name="Get order"], because the refund window runs from the order date.
3. If the order is inside the 30-day window, check [kb id="kb_def456" name="Refund policy"] for the timeline on the payment method used and tell the user what to expect.
4. If it falls outside the window, explain why it is not eligible and offer store credit instead.
5. If the caller asks for a human at any point, run [procedure id="agtprc_xyz789" name="Escalate"].
6. Once the caller has no further questions, use [system_tool id="end_call" name="End call"].
```

A trigger can reference a resource's output, for example `When get_user returns tier 'gold'`.

## Structured Content

Set `content` to a serialized JSON object containing a non-empty `steps` array. The trigger goes in the procedure's top-level `trigger` field, not inside `content`. Each step is an object discriminated by `type`. The step type defines its behavior, so its instruction rarely needs to restate that behavior. The names in parentheses are the labels shown in the dashboard editor.

| `type` | Editor name | Fields | Behavior |
|--------|-------------|--------|----------|
| `ask` | Ask | `instruction` | Asks the user something and waits. Keeps asking until the user answers. The only step that pauses for the user. |
| `tell` | Tell | `instruction` | Conveys something in the agent's own words, then moves on immediately. |
| `say` | Say | `message`, optional `message_translations` (`{ "<lang>": { "value": "..." } }`) | Says an exact message verbatim, then moves on immediately. |
| `tool_call` | Tool | `tool_id`, `tool_name`, optional `instruction`, optional `schema_overrides`, optional `on_failure` | Calls the tool. Always calls it; a condition in the instruction cannot skip it. |
| `branch` | If | `branches` (arms), optional `fallback` (Else) | Evaluates arms in order; first match wins. `fallback` runs when nothing matches. With no `fallback` and no match, control falls through to the next step. |
| `sub_procedure` | Sub-procedure | `procedure_id` | Runs another structured procedure, then returns to the next step here. |
| `system_tool` | System tool | `system_tool_name` | Calls a built-in tool. Only `end_call` is supported; it ends the conversation. |
| `retry` | Retry | `max_retries` (1–3) | Only inside `on_failure`. Re-runs the whole failure handler, tool call included, until the tool succeeds or attempts run out. |

- An arm in `branches` is `{ "condition": <condition>, "steps": [...] }`. A condition is `{ "type": "llm", "condition": "<natural language>" }` (a text condition the model evaluates) or `{ "type": "expression", "expression": <AST> }` (an expression over dynamic variables). Expression conditions cannot read the user's reply; they test variables filled by tool results or set at conversation start.
- `schema_overrides` fixes a tool parameter so the model does not choose it. Keys are parameter paths; each value is `{ "source": "constant", "constant_value": ... }`, `{ "source": "dynamic_variable", "dynamic_variable": "..." }`, `{ "source": "llm", "prompt": "<optional prompt override>" }`, or `{ "source": "omit" }`.
- `on_failure` is `{ "branches": [], "fallback": [...] }`. Today the dashboard exposes only `fallback`, a single block of steps that runs when the tool fails; keep `branches` empty. The handler's steps run and the procedure continues to the next step. A tool step with no `on_failure` ends the conversation on failure.
- Where each step is allowed: inside an If arm, any step except `branch` and `retry`. Inside `on_failure`, any step except `branch` and `tool_call`.

### Validation rules

Saving an agent draft or publishing rejects a structured procedure that breaks any of these, with the offending step's `path`:

- Two `branch` steps cannot be adjacent at the top level.
- A `branch` that uses expression conditions cannot directly follow an `ask`.
- All conditions in one `branch` must be the same kind: all `llm` or all `expression`.
- `retry` may only appear in `on_failure`, and must be the last step there.
- `end_call` must be the last step in whichever list it appears in.
- `on_failure.fallback` must have at least one step.
- A `sub_procedure` must point at an existing structured procedure on the same agent, and not at itself.
- `tool_id` must be a tool on the agent, `tool_name` must match, and `schema_overrides` must match the tool's schema.
- `steps`, `instruction`, and `message` cannot be empty.

### Runtime rules that shape the design

- Only `ask` waits for the user. Every other step runs immediately and control moves to the next step within the same turn. There is no step that stops the turn other than `ask`; use `end_call` to end the conversation.
- Reaching the end of a procedure does not end the turn. The agent returns to its normal behavior with the turn still open and may say more.
- `ask`, `tell`, and `say` steps have no tools. Do not write "do not call tools" into them.
- Decisions made inside a `branch` arm are not remembered by later steps. Persist anything needed downstream with a tool call or a dynamic variable.

### Authoring guidance

- One question per `ask`. Bundled questions get skipped or merged.
- `tell` is for statements. A `tell` phrased as a question never waits for an answer.
- Do not insert an unrelated `tell` or `say` between two `branch` steps to satisfy the adjacency rule; fold the second decision into more arms of the first `branch`, or move it into a `sub_procedure`.
- Nested branching is not allowed. Put the nested steps in a `sub_procedure`.
- Place a `branch` with expression conditions right after the `tool_call` that fills the variables it tests.
- If a tool call is not always meant to happen, put the condition in a `branch` before the `tool_call`.
- When a parameter must always take a specific value, use a `constant` override rather than saying so in the instruction.
- Give every `tool_call` an `on_failure`; without one, any failure ends the conversation.
- Do not describe the next step inside a step, and do not try to end the turn with prose such as "this is the last message of this turn". The runtime does not enforce either.

Validation happens when you publish, or when you save an agent draft to check without publishing; [Using the Procedure API](using-procedure-api.md#validate-without-publishing) describes the loop.

```json
{
  "steps": [
    { "type": "ask", "instruction": "Ask for the order ID." },
    {
      "type": "tool_call",
      "tool_id": "tool_abc123",
      "tool_name": "Get order",
      "schema_overrides": { "include_history": { "source": "constant", "constant_value": false } },
      "on_failure": {
        "branches": [],
        "fallback": [
          { "type": "tell", "instruction": "Apologize that the order lookup failed and say you will try once more." },
          { "type": "retry", "max_retries": 1 }
        ]
      }
    },
    {
      "type": "branch",
      "branches": [
        {
          "condition": { "type": "llm", "condition": "the order is outside the refund window" },
          "steps": [
            { "type": "tell", "instruction": "Explain the order is no longer eligible." },
            { "type": "sub_procedure", "procedure_id": "agtprc_escalate123" }
          ]
        }
      ],
      "fallback": [
        {
          "type": "say",
          "message": "Your refund is on its way.",
          "message_translations": { "es": { "value": "Su reembolso está en camino." } }
        }
      ]
    },
    { "type": "system_tool", "system_tool_name": "end_call" }
  ]
}
```

## Building the Content String

Serialize the object before assigning it to `content`; do not hand-escape quotes.

### Python

```python
import json

content = json.dumps(
    {
        "steps": [
            {"type": "ask", "instruction": "Ask for the order ID."},
            {"type": "say", "message": "Your refund is on its way."},
        ],
    }
)
```

### JavaScript

```javascript
const content = JSON.stringify({
  steps: [
    { type: "ask", instruction: "Ask for the order ID." },
    { type: "say", message: "Your refund is on its way." },
  ],
});
```

### CLI

```bash
# Build the JSON string to pass to `elevenlabs agents procedures create --json`
CONTENT=$(jq -n '{
  steps: [
    { type: "ask", instruction: "Ask for the order ID." },
    { type: "say", message: "Your refund is on its way." }
  ]
}')
```
