use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(thiserror::Error, Debug)]
pub enum LlmError {
  #[error("missing API configuration: {0}")]
  MissingConfig(String),
  #[error("http error: {0}")]
  Http(#[from] reqwest::Error),
  #[error("unexpected response status {status}: {body}")]
  BadStatus { status: u16, body: String },
  #[error("invalid response JSON: {0}")]
  Json(#[from] serde_json::Error),
  #[error("model response missing content")]
  MissingContent,
  #[error("model returned invalid JSON: {0}")]
  InvalidModelJson(String),
}

pub type LlmResult<T> = Result<T, LlmError>;

#[derive(Debug, Clone)]
pub struct LlmConfig {
  pub base_url: String,
  pub api_key: String,
  pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummaryResponse {
  pub title: String,
  pub summary: String,
  pub categories: Vec<DailySummaryCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummaryCategory {
  pub category_name: String,
  pub is_new_category: bool,
  pub entries: Vec<DailySummaryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummaryEntry {
  pub content: String,
  pub source_time: String, // HH:MM
  pub key_points: Vec<String>,
}

#[derive(Clone)]
pub struct LlmClient {
  http: reqwest::Client,
}

impl LlmClient {
  pub fn new() -> LlmResult<Self> {
    let http = reqwest::Client::builder()
      .connect_timeout(Duration::from_secs(30))
      .timeout(Duration::from_secs(120))
      .build()?;
    Ok(Self { http })
  }

  pub async fn test_connection(&self, cfg: &LlmConfig) -> LlmResult<()> {
    let schema = json!({
      "name": "test_connection",
      "strict": true,
      "schema": {
        "type": "object",
        "required": ["status"],
        "additionalProperties": false,
        "properties": {
          "status": { "type": "string", "enum": ["ok"] }
        }
      }
    });

    let _v: Value = self
      .chat_json_schema(
        cfg,
        vec![
          msg_system("You are a connectivity test. Reply with JSON."),
          msg_user("Return {\"status\":\"ok\"}."),
        ],
        schema,
      )
      .await?;
    Ok(())
  }

  pub async fn summarize_day(
    &self,
    cfg: &LlmConfig,
    date: &str,
    notes_chronological: &[(String, String)], // (HH:MM, content)
    existing_categories: &[String],
  ) -> LlmResult<(DailySummaryResponse, Value)> {
    let system_prompt = r#"You are a note structuring assistant. You receive a collection of raw notes taken throughout a day. Your job is to:
1. Generate a concise title for the day (based on main themes).
2. Write a 2-4 sentence summary of the day's notes.
3. Extract and group the notes into logical categories.
4. For each category, provide structured entries with key points.
5. Identify any connections to previous context if provided.

LANGUAGE REQUIREMENT:
- Detect the language of the notes (if mixed, pick the dominant language).
- Write the title, summary, category names, entries, and key points in that same language.
- Keep proper nouns, code, URLs, and product names as-is.

Be precise. Do not invent information not present in the notes. Preserve important details, names, numbers, and action items."#;

    let mut user_msg = String::new();
    user_msg.push_str(&format!("Date: {date}\n\nNotes (chronological):\n---\n"));
    for (time, content) in notes_chronological {
      user_msg.push_str(&format!("[{time}] {content}\n---\n"));
    }
    if !existing_categories.is_empty() {
      user_msg.push_str("\nExisting categories in the knowledge base: ");
      user_msg.push_str(&existing_categories.join(", "));
      user_msg.push_str("\nTry to map entries to existing categories where appropriate. Create new categories only when necessary.\n");
    }

    let schema = daily_summary_schema();
    let structured: Value = self
      .chat_json_schema(
        cfg,
        vec![msg_system(system_prompt), msg_user(&user_msg)],
        schema,
      )
      .await?;

    let parsed: DailySummaryResponse = serde_json::from_value(structured.clone())?;
    Ok((parsed, structured))
  }

  async fn chat_json_schema(
    &self,
    cfg: &LlmConfig,
    messages: Vec<Value>,
    json_schema: Value,
  ) -> LlmResult<Value> {
    if cfg.base_url.trim().is_empty() {
      return Err(LlmError::MissingConfig("base_url is empty".into()));
    }
    if cfg.model.trim().is_empty() {
      return Err(LlmError::MissingConfig("model_name is empty".into()));
    }

    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let body = json!({
      "model": cfg.model,
      "messages": messages,
      "temperature": 0.2,
      "response_format": {
        "type": "json_schema",
        "json_schema": json_schema
      }
    });

    let mut last_err: Option<LlmError> = None;
    for attempt in 0..3 {
      if attempt > 0 {
        let backoff_ms = 250u64 * 2u64.pow(attempt as u32);
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
      }

      let mut req = self.http.post(&url).json(&body);
      if !cfg.api_key.trim().is_empty() {
        req = req.bearer_auth(cfg.api_key.trim());
      }

      match req.send().await {
        Ok(resp) => {
          let status = resp.status();
          let text = resp.text().await.unwrap_or_default();
          if status != StatusCode::OK {
            let err = LlmError::BadStatus {
              status: status.as_u16(),
              body: text,
            };
            // retry 5xx; no retry on 4xx generally
            if status.is_server_error() {
              last_err = Some(err);
              continue;
            }
            return Err(err);
          }
          let v: Value = serde_json::from_str(&text)?;
          let content = extract_first_content(&v).ok_or(LlmError::MissingContent)?;
          let parsed: Value = serde_json::from_str(&content)
            .map_err(|e| LlmError::InvalidModelJson(format!("{e}. raw content: {content}")))?;
          return Ok(parsed);
        }
        Err(e) => {
          last_err = Some(LlmError::Http(e));
          continue;
        }
      }
    }

    Err(last_err.unwrap_or(LlmError::BadStatus {
      status: 0,
      body: "unknown error".into(),
    }))
  }
}

fn msg_system(content: &str) -> Value {
  json!({ "role": "system", "content": content })
}

fn msg_user(content: &str) -> Value {
  json!({ "role": "user", "content": content })
}

fn extract_first_content(v: &Value) -> Option<String> {
  v.get("choices")
    .and_then(|c| c.get(0))
    .and_then(|c0| c0.get("message"))
    .and_then(|m| m.get("content"))
    .and_then(|c| c.as_str())
    .map(|s| s.to_string())
}

fn daily_summary_schema() -> Value {
  // Mirrors the schema provided in the task description.
  json!({
    "name": "daily_summary",
    "strict": true,
    "schema": {
      "type": "object",
      "required": ["title", "summary", "categories"],
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string",
          "description": "A concise title for the day (3-8 words)"
        },
        "summary": {
          "type": "string",
          "description": "2-4 sentence overview of the day's notes"
        },
        "categories": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["category_name", "is_new_category", "entries"],
            "additionalProperties": false,
            "properties": {
              "category_name": {
                "type": "string",
                "description": "Name of the category"
              },
              "is_new_category": {
                "type": "boolean",
                "description": "true if this category doesn't exist yet"
              },
              "entries": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["content", "source_time", "key_points"],
                  "additionalProperties": false,
                  "properties": {
                    "content": {
                      "type": "string",
                      "description": "Structured version of the note content"
                    },
                    "source_time": {
                      "type": "string",
                      "description": "Original timestamp of the source note (HH:MM)"
                    },
                    "key_points": {
                      "type": "array",
                      "items": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
}

