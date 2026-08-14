#!/usr/bin/env bash
# One-time GCP setup: create secrets from .env and grant IAM for Cloud Build + Cloud Run.
# Usage: ./scripts/setup-gcp-secrets.sh
#
# Reads GEMINI_API_KEY and FIREBASE_API_KEY from .env in the repo root when present,
# otherwise prompts for each value.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0520018439}"
REGION="${REGION:-australia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-bsx-style-checker}"
GEMINI_SECRET="${GEMINI_SECRET:-gemini-api-key}"
FIREBASE_SECRET="${FIREBASE_SECRET:-firebase-api-key}"

read_env_var() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 1
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | head -1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  if [[ -n "$value" && "$value" != "MY_${key}" && "$value" != "MY_GEMINI_API_KEY" && "$value" != "MY_FIREBASE_API_KEY" ]]; then
    printf '%s' "$value"
    return 0
  fi
  return 1
}

create_or_update_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if ! gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
    echo "Creating secret '$secret_name'..."
    printf '%s' "$secret_value" | gcloud secrets create "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file=-
  else
    echo "Updating secret '$secret_name' with a new version..."
    printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file=-
  fi
}

grant_secret_access() {
  local secret_name="$1"
  local member="$2"
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project="$PROJECT_ID" \
    --member="$member" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
}

resolve_secret_value() {
  local env_key="$1"
  local prompt_label="$2"
  local value=""

  if value="$(read_env_var "$env_key")"; then
    echo "Using $env_key from $ENV_FILE" >&2
  else
    echo -n "Paste $prompt_label: " >&2
    read -rs value
    echo >&2
  fi

  if [[ -z "$value" ]]; then
    echo "Error: $env_key is required." >&2
    exit 1
  fi
  printf '%s' "$value"
}

echo "Project:         $PROJECT_ID"
echo "Region:          $REGION"
echo "Service:         $SERVICE_NAME"
echo "Gemini secret:   $GEMINI_SECRET"
echo "Firebase secret: $FIREBASE_SECRET"
echo "Env file:        $ENV_FILE"
echo

GEMINI_KEY="$(resolve_secret_value GEMINI_API_KEY "Gemini API key")"
FIREBASE_KEY="$(resolve_secret_value FIREBASE_API_KEY "Firebase API key")"

create_or_update_secret "$GEMINI_SECRET" "$GEMINI_KEY"
create_or_update_secret "$FIREBASE_SECRET" "$FIREBASE_KEY"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
CB_SA="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

echo "Granting Cloud Build service account access..."
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="$CB_SA" \
    --role="$ROLE" \
    --quiet >/dev/null
done

grant_secret_access "$GEMINI_SECRET" "$CB_SA"
grant_secret_access "$FIREBASE_SECRET" "$CB_SA"

# Default Cloud Run runtime SA (used when no custom SA is set on the service)
COMPUTE_SA="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "Granting default Cloud Run runtime SA secret access..."
grant_secret_access "$GEMINI_SECRET" "$COMPUTE_SA"
grant_secret_access "$FIREBASE_SECRET" "$COMPUTE_SA"

if gcloud run services describe "$SERVICE_NAME" --project="$PROJECT_ID" --region="$REGION" &>/dev/null; then
  RUN_SA="$(gcloud run services describe "$SERVICE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(spec.template.spec.serviceAccountName)')"
  if [[ -n "$RUN_SA" && "$RUN_SA" != "null" ]]; then
    echo "Granting Cloud Run runtime SA ($RUN_SA) secret access..."
    grant_secret_access "$GEMINI_SECRET" "serviceAccount:${RUN_SA}"
    grant_secret_access "$FIREBASE_SECRET" "serviceAccount:${RUN_SA}"
  fi
else
  echo "Cloud Run service '$SERVICE_NAME' not found yet — first deploy will create it."
fi

echo
echo "Done. Next steps:"
echo "  1. Connect GitHub to Cloud Build (see DEPLOY.md)"
echo "  2. Create a trigger pointing at cloudbuild.yaml"
echo "  3. Push to main on GitHub"
