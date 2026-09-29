#!/usr/bin/env bash

set -u

test_names=(
    "REG-02 production DB migration"
    "R10.7B backup concurrency"
    "Product import failure activity"
    "Inventory performance"
    "Authoritative billing"
    "Store Credit exact redemption"
    "Return reason"
    "History pagination"
)

test_scripts=(
    "scripts/v1-reg02-production-db-migration-test.js"
    "scripts/r10-7b-backup-concurrency-test.js"
    "scripts/v1-product-import-failure-activity-test.js"
    "scripts/v1-inventory-performance-regression-test.js"
    "scripts/v1-h01-authoritative-billing-test.js"
    "scripts/v1-store-credit-exact-value-redemption-test.js"
    "scripts/v1-return-reason-regression-test.js"
    "scripts/v1-history-pagination-regression-test.js"
)

passed=0
failed_name=""
failed_status=0

for index in "${!test_scripts[@]}"; do
    number=$((index + 1))
    printf '\n============================================================\n'
    printf 'TEST %s/8: %s\n' "$number" "${test_names[$index]}"
    printf 'COMMAND: node %s\n' "${test_scripts[$index]}"
    printf '%s\n' '============================================================'

    if node "${test_scripts[$index]}"; then
        printf 'RESULT %s/8: PASS — %s\n' "$number" "${test_names[$index]}"
        passed=$((passed + 1))
    else
        failed_status=$?
        failed_name="${test_names[$index]}"
        printf 'RESULT %s/8: FAIL (exit %s) — %s\n' "$number" "$failed_status" "$failed_name"
        break
    fi
done

printf '\n============================================================\n'
if [[ -z "$failed_name" ]]; then
    printf 'REL-02C SUMMARY: PASS — %s/8 tests passed.\n' "$passed"
    exit 0
fi

remaining=$((8 - passed - 1))
printf 'REL-02C SUMMARY: FAIL — %s/8 passed; failed: %s (exit %s); %s not run.\n' \
    "$passed" "$failed_name" "$failed_status" "$remaining"
exit "$failed_status"
