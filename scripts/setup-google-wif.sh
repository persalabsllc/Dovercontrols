#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_ID="dovercontrols"
readonly PROJECT_NUMBER="812439006468"
readonly LOCATION="global"
readonly SA_ID="dover-controls-web-admin"
readonly SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
readonly POOL_ID="vercel-dovercontrols"
readonly PROVIDER_ID="vercel"
readonly VERCEL_ISSUER="https://oidc.vercel.com/persa-labs"
readonly VERCEL_AUDIENCE="https://vercel.com/persa-labs"
readonly VERCEL_TEAM_ID="team_r4KoCA2JIhI3iLhIaYLmf77n"
readonly VERCEL_PROJECT_ID="prj_DkMvYt5wNM7CVEUlPdgAiVl57UfX"
readonly ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.vercel_owner_id=assertion.owner_id,attribute.vercel_project_id=assertion.project_id,attribute.vercel_environment=assertion.environment"
readonly ATTRIBUTE_CONDITION="assertion.owner_id == '${VERCEL_TEAM_ID}' && assertion.project_id == '${VERCEL_PROJECT_ID}' && assertion.environment == 'production'"
readonly PROD_SUBJECT="owner:persa-labs:project:dovercontrols:environment:production"
readonly PROD_PRINCIPAL="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/${LOCATION}/workloadIdentityPools/${POOL_ID}/subject/${PROD_SUBJECT}"

gcloud config set project "${PROJECT_ID}" >/dev/null

actual_project_number="$(
  gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)'
)"
if [[ "${actual_project_number}" != "${PROJECT_NUMBER}" ]]; then
  echo "ERROR: ${PROJECT_ID} resolved to ${actual_project_number}; expected ${PROJECT_NUMBER}." >&2
  exit 1
fi

echo "Enabling required Google APIs..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  identitytoolkit.googleapis.com \
  --project="${PROJECT_ID}" \
  --quiet

echo "Ensuring the dedicated Dover Controls service account..."
if ! gcloud iam service-accounts describe "${SA_EMAIL}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_ID}" \
    --project="${PROJECT_ID}" \
    --display-name="Dover Controls Web Admin" \
    --description="Keyless Vercel production identity for Firebase Authentication administration"
fi

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/firebaseauth.admin" \
  --condition=None \
  --quiet >/dev/null

echo "Ensuring the Workload Identity Pool..."
if gcloud iam workload-identity-pools describe "${POOL_ID}" \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools update "${POOL_ID}" \
    --project="${PROJECT_ID}" \
    --location="${LOCATION}" \
    --display-name="Vercel Dover Controls" \
    --description="Production Vercel workloads for Dover Controls" \
    --no-disabled \
    --quiet
else
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --project="${PROJECT_ID}" \
    --location="${LOCATION}" \
    --display-name="Vercel Dover Controls" \
    --description="Production Vercel workloads for Dover Controls"
fi

echo "Ensuring the production-only Vercel OIDC provider..."
if gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location="${LOCATION}" \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="Vercel Production" \
    --issuer-uri="${VERCEL_ISSUER}" \
    --allowed-audiences="${VERCEL_AUDIENCE}" \
    --attribute-mapping="${ATTRIBUTE_MAPPING}" \
    --attribute-condition="${ATTRIBUTE_CONDITION}" \
    --no-disabled \
    --quiet
else
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location="${LOCATION}" \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="Vercel Production" \
    --issuer-uri="${VERCEL_ISSUER}" \
    --allowed-audiences="${VERCEL_AUDIENCE}" \
    --attribute-mapping="${ATTRIBUTE_MAPPING}" \
    --attribute-condition="${ATTRIBUTE_CONDITION}"
fi

echo "Granting only the exact production deployment access..."
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --member="${PROD_PRINCIPAL}" \
  --role="roles/iam.workloadIdentityUser" \
  --condition=None \
  --quiet >/dev/null

echo
echo "DOVER_WIF_SETUP_COMPLETE"
echo "Service account: ${SA_EMAIL}"
echo "Production principal: ${PROD_PRINCIPAL}"
