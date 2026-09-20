'use strict';

// Eenmalig hulpscript: genereert twee sterke wachtwoorden voor de E2E-testaccounts en de
// bijbehorende bcrypt-hash (cost 12, gelijk aan AuthService.hashPassword).
//
// De hash gaat in de seed-migraties (037/038), het wachtwoord uitsluitend in .env — dat bestand
// staat in .gitignore, .env.development NIET. Draai dit script alleen als je de testaccounts
// opnieuw wilt uitgeven; daarna hoort het wachtwoord nergens anders te staan.
//
// Gebruik: node scripts/db/generate-e2e-hashes.js

const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Geen dubbelzinnige tekens (0/O, 1/l/I) en geen quotes, zodat de waarde veilig in .env en in
// een SQL-string past zonder escaping.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_';

function generatePassword(length = 24) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function main() {
  for (const account of ['E2E_TEST', 'E2E_SUPPLIER']) {
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 12);
    console.log(`${account}_PASSWORD=${password}`);
    console.log(`${account}_HASH=${hash}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
