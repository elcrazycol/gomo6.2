#!/bin/bash
# Create mcaptcha database for the mCaptcha CAPTCHA server
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE mcaptcha'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mcaptcha')\gexec
  GRANT ALL PRIVILEGES ON DATABASE mcaptcha TO $POSTGRES_USER;
EOSQL

echo "mcaptcha database ready"
