# Deployment

Push to `main` on GitHub → Cloud Build runs → Cloud Run is created/updated automatically.

Developers do **not** commit secrets. `GEMINI_API_KEY` and `FIREBASE_API_KEY` are stored in GCP Secret Manager and injected at deploy time.

**GCP project:** `gen-lang-client-0520018439`  
**Region:** `australia-southeast1`  
**Cloud Run service name:** `bsx-style-checker`

---

## Fresh setup from scratch (admin checklist)

Use this if Cloud Run was deleted or you're setting up for the first time.

### Step 1 — Enable GCP APIs

Run once in your terminal (requires `gcloud` CLI and project access):

```bash
gcloud config set project gen-lang-client-0520018439

gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

### Step 2 — Upload secrets from your local `.env`

From your **local clone** of this repo (with `.env` containing both keys):

```bash
chmod +x scripts/setup-gcp-secrets.sh
./scripts/setup-gcp-secrets.sh
```

This creates `gemini-api-key` and `firebase-api-key` in Secret Manager and grants IAM for Cloud Build + Cloud Run.

### Step 3 — Create Artifact Registry (Docker repo)

Skip if it already exists.

```bash
gcloud artifacts repositories create cloud-run-source-deploy \
  --project=gen-lang-client-0520018439 \
  --repository-format=docker \
  --location=australia-southeast1 \
  --description="Docker images for bsx-style-checker"
```

### Step 4 — Connect GitHub to Cloud Build

1. Open [Cloud Build → Repositories](https://console.cloud.google.com/cloud-build/repositories)
2. Click **Create host connection** (or **Connect repository**)
3. Select **GitHub** and authenticate
4. Install the Google Cloud Build app on your GitHub org/account
5. Link the `bsx-style-checker` repository

> If you already connected GitHub before, skip to Step 5 and confirm the repo is listed under **Repositories (2nd gen)**.

### Step 5 — Create the Cloud Build trigger

1. Open [Cloud Build → Triggers](https://console.cloud.google.com/cloud-build/triggers)
2. Click **Create trigger**
3. Configure:

| Setting | Value |
|---------|--------|
| Name | `deploy-main` |
| Region | `global` (or your preferred trigger region) |
| Event | Push to a branch |
| Source | Your connected GitHub repo |
| Branch | `^main$` |
| Configuration | Cloud Build configuration file |
| File location | `/cloudbuild.yaml` (repo root) |

4. Under **Substitution variables** — leave defaults unless you changed names in `cloudbuild.yaml`:

| Variable | Default |
|----------|---------|
| `_SERVICE_NAME` | `bsx-style-checker` |
| `_REGION` | `australia-southeast1` |
| `_AR_HOSTNAME` | `australia-southeast1-docker.pkg.dev` |
| `_AR_REPO` | `cloud-run-source-deploy` |
| `_GEMINI_SECRET` | `gemini-api-key` |
| `_FIREBASE_SECRET` | `firebase-api-key` |

5. Save the trigger.

### Step 6 — Push code to GitHub

Commit and push the deploy files to the `main` branch:

```bash
git add cloudbuild.yaml DEPLOY.md scripts/setup-gcp-secrets.sh
git commit -m "Add Cloud Build deploy config"
git push origin main
```

The trigger will automatically:

1. Build the Docker image
2. Push it to Artifact Registry
3. **Create** a new Cloud Run service named `bsx-style-checker` (since you deleted the old one)

Watch progress in [Cloud Build → History](https://console.cloud.google.com/cloud-build/builds).

### Step 7 — Verify the deploy

1. **Cloud Build** — build status is green/succeeded
2. **Cloud Run** — new service `bsx-style-checker` exists in `australia-southeast1`
3. Open the service URL and test AI + Firebase features
4. Check logs if anything fails:

```bash
gcloud run services logs read bsx-style-checker \
  --project=gen-lang-client-0520018439 \
  --region=australia-southeast1 \
  --limit=50
```

Get the service URL:

```bash
gcloud run services describe bsx-style-checker \
  --project=gen-lang-client-0520018439 \
  --region=australia-southeast1 \
  --format='value(status.url)'
```

---

## For developers (day-to-day)

After admin setup is complete:

1. Clone the repo from GitHub.
2. Copy `.env.example` to `.env` and fill in values **for local dev only**.
3. Run locally: `npm install && npm run dev`
4. Push your changes to `main` on GitHub. Deployment happens automatically.

Never commit `.env`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Trigger doesn't fire on push | GitHub not connected or wrong branch | Check trigger branch is `^main$`; confirm repo link in Cloud Build |
| Build fails at Docker push | Artifact Registry repo missing | Run Step 3 above |
| Deploy fails: permission denied | Cloud Build SA missing roles | Re-run `./scripts/setup-gcp-secrets.sh` |
| `GEMINI_API_KEY is not defined` | Secret not mounted | Check `--set-secrets` in `cloudbuild.yaml`; redeploy |
| Firebase auth/connection fails | `FIREBASE_API_KEY` not set | Re-run setup script; confirm `firebase-api-key` secret exists |
| Permission denied on secret at runtime | Runtime SA lacks access | Re-run setup script (grants default compute SA) |
| Service not found after deploy | Wrong region | Confirm `_REGION` is `australia-southeast1` in trigger substitutions |

### Re-deploy manually (without pushing code)

```bash
gcloud builds submit --config=cloudbuild.yaml .
```

Run from a local clone with `gcloud` authenticated to the project.
