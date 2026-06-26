import httpx
import json
import re
from typing import List, Dict, Any

async def fetch_provider_models(provider: str, base_url: str) -> List[str]:
    clean_url = base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if provider == "ollama":
                url = f"{clean_url}/api/tags"
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    models = [m["name"] for m in data.get("models", [])]
                    return models
                else:
                    raise Exception(f"Ollama returned status code {response.status_code}")
            elif provider == "lm-studio":
                api_base = clean_url.rstrip("/v1").rstrip("/v1/")
                url = f"{api_base}/v1/models"
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    models = [m["id"] for m in data.get("data", [])]
                    return models
                else:
                    raise Exception(f"LM Studio returned status code {response.status_code}")
            else:
                raise ValueError(f"Unknown provider: {provider}")
        except httpx.RequestError as exc:
            raise Exception(f"Could not connect to {provider} at {clean_url}: {str(exc)}")
        except Exception as exc:
            raise Exception(f"Error checking models for {provider}: {str(exc)}")

def build_batch_prompt(prompt_template: str, custom_labels: str, items: List[Dict[str, Any]]) -> str:
    labels_str = custom_labels.strip()

    instructions = (
        f"You are a structured data classification assistant. Your task is to classify a batch of texts.\n"
        f"You MUST categorize each text into exactly one of these labels: [{labels_str}].\n"
        f"You MUST respond ONLY with a valid JSON array of objects, where each object contains "
        f'exactly two keys: "id" and "label". Do not include markdown code fences (like ```json) or additional conversational text.\n'
        f"Ensure that the 'id' in your output matches the 'id' of the input item exactly.\n\n"
        f"Format example:\n"
        f'[\n  {{"id": "row_id_1", "label": "LabelA"}},\n  {{"id": "row_id_2", "label": "LabelB"}}\n]\n'
    )

    rendered_template = prompt_template
    if "{labels}" in rendered_template:
        rendered_template = rendered_template.replace("{labels}", labels_str)
    if "{text}" in rendered_template:
        rendered_template = rendered_template.replace("{text}", 'the "text" field of each item in the input JSON array')

    items_json = json.dumps(items, indent=2)

    return f"{instructions}\nInstruction / Guidelines:\n{rendered_template}\n\nInput Data (JSON array):\n{items_json}\n\nJSON Output:"

async def generate_batch_labels(
    provider: str,
    base_url: str,
    model: str,
    prompt_template: str,
    custom_labels: str,
    items: List[Dict[str, Any]]
) -> Dict[str, Dict[str, str]]:
    clean_url = base_url.rstrip("/")
    prompt = build_batch_prompt(prompt_template, custom_labels, items)

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            if provider == "ollama":
                url = f"{clean_url}/api/generate"
                payload = {
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.0
                    }
                }
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json.get("response", "").strip()
                    return parse_and_validate_batch_response(raw_text, items, custom_labels)
                else:
                    raise Exception(f"Ollama returned status code {response.status_code}: {response.text}")

            elif provider == "lm-studio":
                api_base = clean_url.rstrip("/v1").rstrip("/v1/")
                url = f"{api_base}/v1/chat/completions"
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.0,
                    "stream": False
                }
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    res_json = response.json()
                    choices = res_json.get("choices", [])
                    if choices:
                        raw_text = choices[0].get("message", {}).get("content", "").strip()
                        return parse_and_validate_batch_response(raw_text, items, custom_labels)
                    else:
                        raise Exception("LM Studio returned empty choices.")
                else:
                    raise Exception(f"LM Studio returned status code {response.status_code}: {response.text}")
            else:
                raise ValueError(f"Unknown provider: {provider}")
        except httpx.RequestError as exc:
            raise Exception(f"Connection error to {provider}: {str(exc)}")

def parse_and_validate_batch_response(
    raw_text: str,
    items: List[Dict[str, Any]],
    custom_labels: str
) -> Dict[str, Dict[str, str]]:
    cleaned_text = raw_text.strip()
    cleaned_text = re.sub(r'<think>.*?</think>', '', cleaned_text, flags=re.DOTALL | re.IGNORECASE).strip()

    if cleaned_text.startswith("```"):
        lines = cleaned_text.splitlines()
        if lines:
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned_text = "\n".join(lines).strip()

    json_match = re.search(r'\[\s*\{.*?\}\s*\]', cleaned_text, re.DOTALL)
    if json_match:
        cleaned_text = json_match.group(0)

    try:
        results = json.loads(cleaned_text)
    except Exception as e:
        raise ValueError(
            f"Failed to parse response as JSON. Reason: {str(e)}. "
            f"Raw text start: {raw_text[:200]}..."
        )

    if not isinstance(results, list):
        raise ValueError("Model response did not yield a JSON array.")

    input_ids = {str(item["id"]) for item in items}
    validated_results = {}

    for idx, item in enumerate(results):
        if not isinstance(item, dict):
            raise ValueError(f"Array item at index {idx} is not a JSON object.")
        if "id" not in item or "label" not in item:
            raise ValueError(f"Array item at index {idx} is missing 'id' or 'label' key.")

        row_id = str(item["id"])
        label_val = str(item["label"]).strip()

        if row_id not in input_ids:
            raise ValueError(f"Returned ID '{row_id}' not found in the input batch.")

        matched_label = None
        for allowed in custom_labels.split(","):
            cleaned_allowed = allowed.strip()
            if cleaned_allowed.lower() == label_val.lower():
                matched_label = cleaned_allowed
                break

        if not matched_label:
            raise ValueError(
                f"Label '{label_val}' for row '{row_id}' is not in the allowed custom labels list. "
                f"Expected one of: [{custom_labels}]"
            )

        validated_results[row_id] = {
            "label": matched_label,
            "raw_response": json.dumps(item)
        }

    missing_ids = input_ids - set(validated_results.keys())
    if missing_ids:
        raise ValueError(f"Model response missed some required IDs: {missing_ids}")

    return validated_results
