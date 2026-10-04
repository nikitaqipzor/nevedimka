#!/usr/bin/env bash
set -Eeuo pipefail
if [ "$APP_DB_USER" = "$POSTGRES_USER" ]; then
  echo "APP_DB_USER must differ from POSTGRES_USER" >&2
  exit 1
fi
# Compose embeds passwords in connection URLs. Fail before generating a
# malformed URL; use openssl rand -hex 32 for both deployment passwords.
for password in "$APP_DB_PASSWORD" "$PGPASSWORD"; do
  if [[ ! "$password" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Compose database passwords must use URL-safe characters" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_db_user="$APP_DB_USER" \
  --set=app_db_password="$APP_DB_PASSWORD" <<'EOSQL'
select format('create role %I login password %L nobypassrls', :'app_db_user', :'app_db_password')
where not exists (select 1 from pg_roles where rolname = :'app_db_user') \gexec

select format(
  'alter role %I login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
  :'app_db_user',
  :'app_db_password'
) \gexec
select format('grant usage on schema public to %I', :'app_db_user') \gexec
select format(
  'grant select, insert, update, delete on all tables in schema public to %I',
  :'app_db_user'
) \gexec
select format(
  'grant usage, select on all sequences in schema public to %I',
  :'app_db_user'
) \gexec
select format(
  'alter default privileges in schema public grant select, insert, update, delete on tables to %I',
  :'app_db_user'
) \gexec
select format(
  'alter default privileges in schema public grant usage, select on sequences to %I',
  :'app_db_user'
) \gexec
EOSQL
