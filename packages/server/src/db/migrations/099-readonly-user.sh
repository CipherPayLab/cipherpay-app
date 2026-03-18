#!/bin/bash
# Runs at MySQL container init time (fresh volume only).
# Creates a read-only user for cipherpay-zkaudit and other consumers.
set -e

READONLY_USER="${MYSQL_READONLY_USER:-readonly_user}"
READONLY_PASSWORD="${MYSQL_READONLY_PASSWORD:-readonly_password}"
DB="${MYSQL_DATABASE:-cipherpay_server}"

mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<EOF
CREATE USER IF NOT EXISTS '${READONLY_USER}'@'%' IDENTIFIED BY '${READONLY_PASSWORD}';
GRANT SELECT ON \`${DB}\`.* TO '${READONLY_USER}'@'%';
FLUSH PRIVILEGES;
EOF

echo "[init-readonly-user] Created read-only user '${READONLY_USER}' on database '${DB}'."
