'use strict';

// Controleert dat de wachtwoorden in .env horen bij de bcrypt-hashes in de seed-migraties.
// Vangt een kopieerfout af vóór de migratie op DEV draait en de e2e-suite onverklaarbaar faalt.
//
// Gebruik: node scripts/db/verify-e2e-hashes.js

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CASES = [
  ['037_seed_e2e_test_user.sql', 'E2E_TEST_PASSWORD'],
  ['038_seed_e2e_supplier_test_user.sql', 'E2E_SUPPLIER_PASSWORD'],
];

async function main() {
  let failed = false;

  for (const [file, envKey] of CASES) {
    const password = process.env[envKey];
    if (!password) {
      console.log(`${file}: ${envKey} ontbreekt in .env`);
      failed = true;
      continue;
    }

    const content = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
    const match = content.match(/\$2b\$12\$[^']+/);
    if (!match) {
      console.log(`${file}: geen bcrypt-hash gevonden`);
      failed = true;
      continue;
    }

    const ok = await bcrypt.compare(password, match[0]);
    console.log(`${file}: ${ok ? 'MATCH' : 'MISMATCH'}`);
    if (!ok) failed = true;
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
