# Provider catalog and API keys

Backend profiles let Claude Code agents use an API key from a hosted model
provider. Common providers are preloaded with an API endpoint, the protocol
the local proxy supports, and a starter model. The user selects a provider,
pastes its key and saves. The first API key configured becomes the default
backend; later keys do not silently replace it. A user can fetch the models
available to a key and change the starter model at any time.

Keys are written to `apps/server/.env.local`, which is ignored by Git. The
JSON registry stores environment-variable names and provider settings, never
the key values. Base URLs are editable because some services use different
endpoints by region or account.

## Built-in providers

| Provider | Base URL | API format | Starter model |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | OpenAI Chat Completions | `gpt-6-astra` |
| Anthropic Claude | `https://api.anthropic.com` | Anthropic Messages | `claude-sonnet-5` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI Chat Completions | `gemini-3.8-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI Chat Completions | `openai/gpt-6-astra` |
| DeepSeek | `https://api.deepseek.com` | OpenAI Chat Completions | `deepseek-flash` |
| Groq | `https://api.groq.com/openai/v1` | OpenAI Chat Completions | `openai/gpt-oss-20b` |
| Mistral AI | `https://api.mistral.ai/v1` | OpenAI Chat Completions | `mistral-large-latest` |
| xAI Grok | `https://api.x.ai/v1` | OpenAI Chat Completions | `grok-4.7` |
| SiliconFlow | `https://api.siliconflow.com/v1` | OpenAI Chat Completions | `deepseek-ai/DeepSeek-V3` |
| Alibaba Cloud Qwen | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | OpenAI Chat Completions | `qwen-plus` |
| Moonshot AI Kimi | `https://api.moonshot.ai/v1` | OpenAI Chat Completions | `kimi-k2.6` |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | OpenAI Chat Completions | `openai/gpt-oss-20b` |

Provider endpoints and compatibility references:

- [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart)
- [Anthropic API overview](https://platform.claude.com/docs/en/api/overview)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart)
- [DeepSeek API quickstart](https://api-docs.deepseek.com/quick_start)
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [Mistral API quickstart](https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request)
- [xAI REST API reference](https://docs.x.ai/developers/rest-api-reference/inference)
- [SiliconFlow API examples](https://github.com/siliconflow/siliconflow-open-source-tasks/blob/main/README_EN.md)
- [Alibaba Model Studio Base URLs](https://help.aliyun.com/en/model-studio/base-url)
- [NVIDIA NIM models](https://build.nvidia.com/models)
- [Moonshot AI platform docs](https://platform.moonshot.ai/docs)

The Alibaba preset uses the Singapore endpoint. Model Studio keys are
region-specific, so select the Base URL shown in the provider console if the
key belongs to another region. NVIDIA model availability also depends on the
selected NIM endpoint; use **Fetch Models** if the starter model is not
enabled for the key.

## Retired default entries

The old b.ai, Experiential Labs and vyceai defaults were removed because
they are less commonly used or lack a reliable, documented setup for this
project. On upgrade, the app removes only matching built-in rows and their
own key/Base URL assignments from `.env.local`; unrelated custom profiles
and environment variables are preserved. Agents that referenced a retired
profile return to the configured global default.

## API formats supported by this project

`anthropic` passes Anthropic Messages API requests through, applying the
profile's key and model mapping. `openai-chat-completions` translates the
Claude Code Messages request and response to OpenAI Chat Completions. The
translation covers the shared chat and tool-call shape; provider-specific
features outside that shape may not be available. The proxy does not
translate OpenAI Responses API requests.
