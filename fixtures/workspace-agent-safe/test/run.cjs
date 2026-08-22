const fs = require('fs');

const source = fs.readFileSync('src/index.ts', 'utf8');
if (!source.includes('export const retries: string = "three";')) {
  console.error('Expected the safe agent repair to change retries to a string literal type.');
  process.exit(1);
}
console.log('Fixture verification passed.');
