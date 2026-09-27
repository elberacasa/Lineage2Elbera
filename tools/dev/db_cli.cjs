// Explicit private MariaDB configuration for historical local test helpers.
// Loading this module never connects to a database or reads credential contents.
const fs = require('node:fs');
const path = require('node:path');

function dbArgs(env = process.env) {
  const required = (name) => {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      throw new Error(`Set ${name} explicitly before using this database helper`);
    }
    return value;
  };
  const file = required('L2_DB_DEFAULTS_FILE');
  const database = required('L2_DB_NAME');
  if (!path.isAbsolute(file)) throw new Error('L2_DB_DEFAULTS_FILE must be an absolute private option-file path');
  try {
    if (!fs.statSync(file).isFile()) throw new Error('not a file');
    fs.accessSync(file, fs.constants.R_OK);
  } catch {
    throw new Error('L2_DB_DEFAULTS_FILE must name a readable private option file');
  }
  // MariaDB requires this option first. Passwords stay in the private file,
  // rather than command arguments, source code or shell interpolation.
  return [`--defaults-file=${file}`, `--database=${database}`];
}

module.exports = { dbArgs };
